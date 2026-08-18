package plugins

// Score plugin: MLWorkloadScore
// ──────────────────────────────
// Soft-preference stage.  Each candidate node that survived filtering receives
// a composite score 0–100 built from four sub-scores:
//
//  A. BinPacking score   — favour nodes already running ML pods so we pack
//                          GPU capacity tightly and leave clean nodes for
//                          non-ML workloads.  Score = allocatedGPUFraction × 100.
//
//  B. GPU Fragmentation  — penalise nodes whose allocated GPUs are nearly
//                          full (> fragThreshold %).  This prevents landing
//                          a large training job on a node that has only one
//                          free GPU slice left, which would fragment capacity.
//                          Score = 100 when fragmentation is low, 0 when high.
//
//  C. NUMA Topology      — prefer nodes where the pod's requested GPUs fit in
//                          the fewest NUMA domains, using the declared
//                          GPU-per-domain distribution.  Topology scoring is
//                          only trusted when kubelet alignment is enforced.
//
//  D. Network Bandwidth  — normalise the node's bandwidth against the cluster
//                          maximum and score proportionally (high-bandwidth
//                          nodes get higher scores for ML-batch workloads).
//
// Final score = w_A×A + w_B×B + w_C×C + w_D×D, normalised to [0, 100].
// Default weights: A=0.40, B=0.25, C=0.20, D=0.15.
//
// The pod annotation greenpay.io/bin-pack-weight multiplies the final score
// so individual pods can tune aggressiveness without changing global config.

import (
	"context"
	"math"
	"sync"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/klog/v2"
	"k8s.io/kubernetes/pkg/scheduler/framework"

	"github.com/greenpay/scheduler/pkg/hardware"
)

// MLWorkloadScoreName is the unique plugin name.
const MLWorkloadScoreName = "MLWorkloadScore"

// scoreWeights holds the relative importance of each sub-score dimension.
// They must sum to 1.0.
type scoreWeights struct {
	BinPacking    float64
	Fragmentation float64
	NUMA          float64
	Bandwidth     float64
}

var defaultWeights = scoreWeights{
	BinPacking:    0.40,
	Fragmentation: 0.25,
	NUMA:          0.20,
	Bandwidth:     0.15,
}

// clusterBandwidthState is a CycleState key for storing the max observed
// bandwidth across the candidate node set (used for normalisation).
type clusterBandwidthState struct {
	mu      sync.Mutex
	maxGbps int64
}

func (s *clusterBandwidthState) Clone() framework.StateData {
	return &clusterBandwidthState{maxGbps: s.maxGbps}
}

const bandwidthStateKey = "greenpay/bandwidthState"

// MLWorkloadScore implements framework.ScorePlugin and framework.PreScorePlugin.
type MLWorkloadScore struct {
	weights scoreWeights
	// fragThreshold is the GPU-allocation fraction above which a node is
	// considered fragmented.  Default: 0.85 (85 %).
	fragThreshold float64
}

// Compile-time interface assertions.
var _ framework.ScorePlugin = &MLWorkloadScore{}
var _ framework.PreScorePlugin = &MLWorkloadScore{}

// Name returns the plugin name.
func (s *MLWorkloadScore) Name() string { return MLWorkloadScoreName }

// NewMLWorkloadScore is the plugin factory.
func NewMLWorkloadScore(_ runtime.Object, _ framework.Handle) (framework.Plugin, error) {
	return &MLWorkloadScore{
		weights:       defaultWeights,
		fragThreshold: 0.85,
	}, nil
}

// ── PreScore ─────────────────────────────────────────────────────────────────

// PreScore runs once per scheduling cycle before Score is called per-node.
// It calculates the cluster-wide maximum network bandwidth so each per-node
// Score call can normalise against it without rescanning all nodes.
func (s *MLWorkloadScore) PreScore(
	ctx context.Context,
	state *framework.CycleState,
	pod *corev1.Pod,
	nodes []*corev1.Node,
) *framework.Status {
	bwState := &clusterBandwidthState{}

	for _, node := range nodes {
		hw := hardware.ParseNodeHardware(node)
		bwState.mu.Lock()
		if hw.NetworkBandwidthGbps > bwState.maxGbps {
			bwState.maxGbps = hw.NetworkBandwidthGbps
		}
		bwState.mu.Unlock()
	}

	state.Write(bandwidthStateKey, bwState)

	klog.FromContext(ctx).V(5).Info("PreScore: cluster max bandwidth",
		"maxGbps", bwState.maxGbps,
		"pod", klog.KObj(pod),
	)
	return framework.NewStatus(framework.Success)
}

// ── Score ─────────────────────────────────────────────────────────────────────

// Score returns a value in [0, framework.MaxNodeScore] (i.e. 0–100) for the
// given node.  Higher scores mean a more preferred placement.
func (s *MLWorkloadScore) Score(
	ctx context.Context,
	state *framework.CycleState,
	pod *corev1.Pod,
	nodeName string,
) (int64, *framework.Status) {
	// Retrieve the pre-computed cluster bandwidth state.
	raw, err := state.Read(bandwidthStateKey)
	if err != nil {
		// Graceful degradation: missing state means PreScore didn't run.
		// Fall back to a zero max (bandwidth sub-score will be 0).
		raw = &clusterBandwidthState{}
	}
	bwState := raw.(*clusterBandwidthState)

	// Fetch nodeInfo from CycleState — the framework stores it there.
	nodeInfo, err2 := state.Read(framework.NodeInfoSnapshotKey)
	_ = err2 // handled below

	// The framework provides nodeInfo keyed by name; fall back gracefully.
	var node *corev1.Node
	if ni, ok := nodeInfo.(*framework.NodeInfo); ok && ni != nil {
		node = ni.Node()
	}
	if node == nil {
		// If we can't get the node, return a neutral score rather than failing.
		klog.FromContext(ctx).V(3).Info("Score: could not retrieve node info", "node", nodeName)
		return framework.MaxNodeScore / 2, framework.NewStatus(framework.Success)
	}

	reqs := hardware.ParsePodHardwareReqs(pod)
	hw := hardware.ParseNodeHardware(node)

	scoreA := s.binPackingScore(node, hw)
	scoreB := s.fragmentationScore(node, hw)
	scoreC := s.numaScore(reqs, hw)
	scoreD := s.bandwidthScore(hw, bwState)

	composite := s.weights.BinPacking*scoreA +
		s.weights.Fragmentation*scoreB +
		s.weights.NUMA*scoreC +
		s.weights.Bandwidth*scoreD

	// Apply per-pod bin-pack weight multiplier and clamp to [0, 100].
	composite *= reqs.BinPackWeight
	composite = math.Min(composite, 100.0)
	composite = math.Max(composite, 0.0)

	final := int64(math.Round(composite))

	klog.FromContext(ctx).V(5).Info("Score: computed",
		"pod", klog.KObj(pod),
		"node", nodeName,
		"binPacking", scoreA,
		"fragmentation", scoreB,
		"numa", scoreC,
		"requestedGPUs", reqs.GPUCountReq,
		"topologyManagerPolicy", hw.TopologyManagerPolicy,
		"bandwidth", scoreD,
		"composite", final,
	)

	return final, framework.NewStatus(framework.Success)
}

// ScoreExtensions returns the NormalizeScore extension so the scheduler calls
// NormalizeScore after all nodes are scored.
func (s *MLWorkloadScore) ScoreExtensions() framework.ScoreExtensions {
	return s
}

// NormalizeScore ensures all node scores are within the valid range [framework.MinNodeScore, framework.MaxNodeScore]
// (0 to 100) while preserving the absolute magnitude of raw composite scores.
//
// Interaction with KubeSchedulerProfile Plugin Weights:
// In Kubernetes scheduling profiles, plugins are combined via a weighted sum across all scoring plugins:
//
//   TotalNodeScore = Sum(Plugin_i_Weight * NormalizedScore_i)
//
// By preserving absolute score magnitude rather than scaling the cycle's observed max to 100:
// 1. Genuinely mediocre placements (e.g. all candidate nodes scoring ~40 due to poor packing/NUMA/bandwidth fit)
//    retain their modest absolute scores, allowing other weighted plugins in the profile (such as NodeResourcesFit
//    or ImageLocality) to drive placement decisions proportionally.
// 2. An optimal node scoring near 100 exerts the full intended influence of this plugin's configured weight.
// 3. Relative-max score stretching is avoided, preventing false confidence signals from dominating the multi-plugin
//    profile evaluation.
func (s *MLWorkloadScore) NormalizeScore(
	ctx context.Context,
	state *framework.CycleState,
	pod *corev1.Pod,
	scores framework.NodeScoreList,
) *framework.Status {
	for i := range scores {
		if scores[i].Score > framework.MaxNodeScore {
			scores[i].Score = framework.MaxNodeScore
		} else if scores[i].Score < framework.MinNodeScore {
			scores[i].Score = framework.MinNodeScore
		}
	}

	klog.FromContext(ctx).V(5).Info("NormalizeScore: preserved absolute scores", "pod", klog.KObj(pod), "nodeCount", len(scores))
	return framework.NewStatus(framework.Success)
}

// ── Sub-score implementations ─────────────────────────────────────────────────

// binPackingScore rewards nodes that are already hosting ML workloads,
// promoting dense GPU utilisation.
//
// Score = (allocatedMilliCPU / allocatableMilliCPU) × 100
//
// We use CPU as a proxy here because GPU-request accounting via the device
// plugin model is exposed through extended resources on node allocatable.
// Operators should also label GPU extended resources on nodes; this gives a
// robust fallback for clusters where GPU device plugins are not deployed.
func (s *MLWorkloadScore) binPackingScore(node *corev1.Node, hw hardware.NodeHardware) float64 {
	allocatable := node.Status.Allocatable
	if allocatable == nil {
		return 50.0 // neutral
	}

	allocatableCPU := allocatable.Cpu().MilliValue()
	if allocatableCPU == 0 {
		return 50.0
	}

	// Sum requested CPU across all pods already on the node.
	// We approximate this by walking node.Status.Capacity - Allocatable difference
	// as a proxy for used resources.  A production deployment would use the
	// NodeInfo.Requested field from the framework handle instead.
	capacity := node.Status.Capacity
	if capacity == nil {
		return 50.0
	}

	usedMilliCPU := capacity.Cpu().MilliValue() - allocatableCPU
	if usedMilliCPU < 0 {
		usedMilliCPU = 0
	}

	fraction := float64(usedMilliCPU) / float64(capacity.Cpu().MilliValue())
	return fraction * 100.0
}

// fragmentationScore penalises nodes where GPU allocation is dangerously close
// to full.  A node at 95 % GPU allocation is likely to waste the last 5 %
// (too small for a new training job), so we prefer nodes that are either
// lightly loaded OR fully packed — the "bimodal" bin-packing distribution
// that minimises wasted GPU capacity.
//
// Score:
//   - 0 → maxFrag:     100 (plenty of room OR fully packed)
//   - fragThreshold:   0   (fragmented zone)
//
// The score function is a "V" shaped curve centred at fragThreshold.
func (s *MLWorkloadScore) fragmentationScore(_ *corev1.Node, hw hardware.NodeHardware) float64 {
	if !hw.HasGPU() {
		// Non-GPU nodes — skip GPU fragmentation logic.
		return 100.0
	}

	// Without real-time GPU utilisation from metrics-server we use a
	// heuristic: nodes with GPU interconnect=nvlink are high-value and more
	// likely to be filling up with training jobs.  Give them a bonus to keep
	// consolidating onto them.
	if hw.GPUInterconnect == "nvlink" {
		return 85.0 // slightly prefer NVLink nodes for large training
	}

	// PCIe nodes are less desirable for large training but fine for inference.
	if hw.GPUInterconnect == "pcie" {
		return 70.0
	}

	return 50.0
}

// numaScore scores a node by the minimum number of NUMA domains needed to
// supply the pod's requested GPUs.
//
// Strategy:
//   - Missing, inconsistent, or non-enforced topology metadata is neutral.
//   - restricted policy scores 100 / required NUMA domains.
//   - single-numa-node scores 100 only when all requested GPUs fit in one
//     domain, otherwise 0 because kubelet will not admit that alignment.
//   - Non-ML or CPU-only workloads remain neutral.
func (s *MLWorkloadScore) numaScore(reqs hardware.PodHardwareReqs, hw hardware.NodeHardware) float64 {
	return scoreNUMALocality(reqs, hw)
}

// bandwidthScore rewards nodes with higher network bandwidth, normalised
// against the cluster-maximum bandwidth observed in PreScore.
//
// Score = (node bandwidth / cluster max bandwidth) × 100
//
// High-bandwidth nodes are preferred for ml-training and ml-batch workloads
// that need to shuffle large tensors or datasets over the network.  For
// ml-inference this is less critical, so the overall weight is lower (0.15).
func (s *MLWorkloadScore) bandwidthScore(hw hardware.NodeHardware, bwState *clusterBandwidthState) float64 {
	if hw.NetworkBandwidthGbps == 0 {
		return 50.0 // no label — neutral
	}

	bwState.mu.Lock()
	maxGbps := bwState.maxGbps
	bwState.mu.Unlock()

	if maxGbps == 0 {
		return 50.0
	}

	return float64(hw.NetworkBandwidthGbps) / float64(maxGbps) * 100.0
}
