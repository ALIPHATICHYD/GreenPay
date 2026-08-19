package plugins_test

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/kubernetes/pkg/scheduler/framework"

	"github.com/greenpay/scheduler/pkg/plugins"
)

func newScorePlugin(t *testing.T) *plugins.MLWorkloadScore {
	t.Helper()
	p, err := plugins.NewMLWorkloadScore(context.Background(), nil, nil)
	if err != nil {
		t.Fatalf("NewMLWorkloadScore: %v", err)
	}
	return p.(*plugins.MLWorkloadScore)
}

func TestNormalizeScore_PreservesAbsoluteMagnitude_MediocreCluster(t *testing.T) {
	plugin := newScorePlugin(t)
	pod := &corev1.Pod{}

	// Cluster of candidate nodes with mediocre scores (~40).
	// Under relative-max normalization, node-2 (42) would previously get stretched to 100.
	scores := framework.NodeScoreList{
		{Name: "node-1", Score: 38},
		{Name: "node-2", Score: 42},
		{Name: "node-3", Score: 40},
	}

	status := plugin.NormalizeScore(context.Background(), &framework.CycleState{}, pod, scores)
	if !status.IsSuccess() {
		t.Fatalf("NormalizeScore failed: %v", status.Message())
	}

	// Assert that no node was stretched to MaxNodeScore (100).
	for _, ns := range scores {
		if ns.Score == framework.MaxNodeScore {
			t.Errorf("node %s was incorrectly stretched to MaxNodeScore (100)", ns.Name)
		}
	}

	// Assert exact absolute score preservation.
	expected := map[string]int64{
		"node-1": 38,
		"node-2": 42,
		"node-3": 40,
	}

	for _, ns := range scores {
		exp, ok := expected[ns.Name]
		if !ok {
			t.Errorf("unexpected node: %s", ns.Name)
			continue
		}
		if ns.Score != exp {
			t.Errorf("node %s: expected score %d, got %d", ns.Name, exp, ns.Score)
		}
	}
}

func TestNormalizeScore_ClampsOutOfRangeScores(t *testing.T) {
	plugin := newScorePlugin(t)
	pod := &corev1.Pod{}

	scores := framework.NodeScoreList{
		{Name: "node-negative", Score: -10},
		{Name: "node-valid", Score: 50},
		{Name: "node-overflow", Score: 120},
	}

	status := plugin.NormalizeScore(context.Background(), &framework.CycleState{}, pod, scores)
	if !status.IsSuccess() {
		t.Fatalf("NormalizeScore failed: %v", status.Message())
	}

	expected := map[string]int64{
		"node-negative": framework.MinNodeScore, // 0
		"node-valid":    50,
		"node-overflow": framework.MaxNodeScore, // 100
	}

	for _, ns := range scores {
		exp := expected[ns.Name]
		if ns.Score != exp {
			t.Errorf("node %s: expected score %d, got %d", ns.Name, exp, ns.Score)
		}
	}
}

func TestNormalizeScore_HighScoreCluster_PreservesHighScores(t *testing.T) {
	plugin := newScorePlugin(t)
	pod := &corev1.Pod{}

	scores := framework.NodeScoreList{
		{Name: "node-optimal", Score: 95},
		{Name: "node-good", Score: 85},
		{Name: "node-fair", Score: 70},
	}

	status := plugin.NormalizeScore(context.Background(), &framework.CycleState{}, pod, scores)
	if !status.IsSuccess() {
		t.Fatalf("NormalizeScore failed: %v", status.Message())
	}

	expected := map[string]int64{
		"node-optimal": 95,
		"node-good":    85,
		"node-fair":    70,
	}

	for _, ns := range scores {
		exp := expected[ns.Name]
		if ns.Score != exp {
			t.Errorf("node %s: expected score %d, got %d", ns.Name, exp, ns.Score)
		}
	}
}

func TestScoreExtensions_ReturnsSelf(t *testing.T) {
	plugin := newScorePlugin(t)
	ext := plugin.ScoreExtensions()
	if ext == nil {
		t.Fatal("expected ScoreExtensions to return non-nil")
	}
	if ext != plugin {
		t.Fatal("expected ScoreExtensions to return the plugin itself")
	}
}

func TestMLWorkloadScore_ConfigurableFragThreshold(t *testing.T) {
	// Default fragThreshold is 0.85.
	pluginDefault := newScorePlugin(t)
	if pluginDefault.FragThreshold() != 0.85 {
		t.Errorf("expected default fragThreshold 0.85, got %f", pluginDefault.FragThreshold())
	}

	// Configured via args.
	p, err := plugins.NewMLWorkloadScore(context.Background(), &plugins.MLWorkloadScoreArgs{FragThreshold: 0.60}, nil)
	if err != nil {
		t.Fatalf("NewMLWorkloadScore: %v", err)
	}
	pluginArgs := p.(*plugins.MLWorkloadScore)
	if pluginArgs.FragThreshold() != 0.60 {
		t.Errorf("expected fragThreshold 0.60, got %f", pluginArgs.FragThreshold())
	}

	// Configured via setter.
	pluginDefault.SetFragThreshold(0.75)
	if pluginDefault.FragThreshold() != 0.75 {
		t.Errorf("expected fragThreshold 0.75 after SetFragThreshold, got %f", pluginDefault.FragThreshold())
	}
}

func TestFragmentationScore_VCurve(t *testing.T) {
	ctx := context.Background()

	lister := &mockNodeInfoLister{}
	handle := &mockHandle{
		sharedLister: &mockSharedLister{
			nodeLister: lister,
		},
	}

	// Helper to create a NodeInfo snapshot with given requested and allocatable GPUs
	makeNodeInfoSnapshot := func(nodeName string, totalGPUs, requestedGPUs int64) (*framework.CycleState, *corev1.Node) {
		node := &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{
				Name: nodeName,
				Labels: map[string]string{
					"greenpay.io/gpu-vendor": "nvidia",
					"greenpay.io/gpu-count":  "8",
				},
			},
		}

		ni := framework.NewNodeInfo()
		ni.SetNode(node)
		if ni.Allocatable == nil {
			ni.Allocatable = &framework.Resource{}
		}
		if ni.Allocatable.ScalarResources == nil {
			ni.Allocatable.ScalarResources = make(map[corev1.ResourceName]int64)
		}
		ni.Allocatable.ScalarResources["nvidia.com/gpu"] = totalGPUs

		if ni.Requested == nil {
			ni.Requested = &framework.Resource{}
		}
		if ni.Requested.ScalarResources == nil {
			ni.Requested.ScalarResources = make(map[corev1.ResourceName]int64)
		}
		ni.Requested.ScalarResources["nvidia.com/gpu"] = requestedGPUs

		lister.nodes = append(lister.nodes, ni)
		state := framework.NewCycleState()
		return state, node
	}

	pod := &corev1.Pod{}
	p, err := plugins.NewMLWorkloadScore(ctx, nil, handle)
	if err != nil {
		t.Fatalf("NewMLWorkloadScore: %v", err)
	}
	plugin := p.(*plugins.MLWorkloadScore)

	// 0% allocation (0 of 8 GPUs): score near 0% should be high
	state0, _ := makeNodeInfoSnapshot("node-0", 8, 0)
	score0, status := plugin.Score(ctx, state0, pod, "node-0")
	if !status.IsSuccess() {
		t.Fatalf("Score failed: %v", status.Message())
	}

	// 100% allocation (8 of 8 GPUs): score near 100% should be high
	state100, _ := makeNodeInfoSnapshot("node-100", 8, 8)
	score100, status := plugin.Score(ctx, state100, pod, "node-100")
	if !status.IsSuccess() {
		t.Fatalf("Score failed: %v", status.Message())
	}

	// 87.5% allocation (7 of 8 GPUs, close to 85% threshold): score should be low
	state85, _ := makeNodeInfoSnapshot("node-85", 8, 7)
	score85, status := plugin.Score(ctx, state85, pod, "node-85")
	if !status.IsSuccess() {
		t.Fatalf("Score failed: %v", status.Message())
	}

	// Scores near 0% and 100% allocation score high, near fragThreshold scores low.
	if score0 <= score85 {
		t.Errorf("expected 0%% allocation score (%d) to be higher than near-fragThreshold score (%d)", score0, score85)
	}
	if score100 <= score85 {
		t.Errorf("expected 100%% allocation score (%d) to be higher than near-fragThreshold score (%d)", score100, score85)
	}

	// Verify custom fragThreshold shift (e.g. fragThreshold = 0.50)
	plugin.SetFragThreshold(0.50)

	// 50% allocation (4 of 8 GPUs): should score low under threshold 0.50
	state50, _ := makeNodeInfoSnapshot("node-50", 8, 4)
	score50, status := plugin.Score(ctx, state50, pod, "node-50")
	if !status.IsSuccess() {
		t.Fatalf("Score failed: %v", status.Message())
	}

	if score0 <= score50 {
		t.Errorf("with fragThreshold=0.50, expected 0%% allocation score (%d) > 50%% allocation score (%d)", score0, score50)
	}
}

// ── Node-resolution regression tests ─────────────────────────────────────────
//
// Score() resolves the candidate node through the framework handle's shared
// lister. When that resolution is broken, every node falls into the neutral
// fallback (MaxNodeScore/2) and the plugin becomes a silent no-op that still
// returns Success — so a test that only checks "Score returned without error"
// passes while the plugin does nothing.
//
// The tests below assert the thing that cannot be true of a no-op: that the
// scores actually move with real node data, one sub-score dimension at a time
// and across a realistic heterogeneous node set.

// mlNodeSpec describes a node in a test cluster.
type mlNodeSpec struct {
	name string
	// labels are merged over the GPU defaults; set a value to "" to drop it.
	labels map[string]string
	// allocatableCPU is both capacity and allocatable, in whole cores, so the
	// capacity-minus-allocatable proxy is identically zero for every node here
	// and cannot be what makes the scores differ.
	allocatableCPU int64
	gpuAllocatable int64
	// pods already placed on the node.
	placedCPUMilli int64
	placedGPUs     int64
}

func buildNode(spec mlNodeSpec) *corev1.Node {
	labels := map[string]string{}
	for k, v := range spec.labels {
		if v != "" {
			labels[k] = v
		}
	}

	quantity := func(cores int64) resource.Quantity { return *resource.NewQuantity(cores, resource.DecimalSI) }
	resources := corev1.ResourceList{corev1.ResourceCPU: quantity(spec.allocatableCPU)}
	if spec.gpuAllocatable > 0 {
		resources["nvidia.com/gpu"] = quantity(spec.gpuAllocatable)
	}

	return &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: spec.name, Labels: labels},
		Status: corev1.NodeStatus{
			Capacity:    resources,
			Allocatable: resources.DeepCopy(),
		},
	}
}

// buildNodeInfo places the spec's existing workload on the node through
// NodeInfo.AddPod, the same accounting path the real scheduler snapshot uses.
func buildNodeInfo(spec mlNodeSpec) *framework.NodeInfo {
	ni := framework.NewNodeInfo()
	ni.SetNode(buildNode(spec))

	if spec.placedCPUMilli > 0 || spec.placedGPUs > 0 {
		requests := corev1.ResourceList{
			corev1.ResourceCPU: *resource.NewMilliQuantity(spec.placedCPUMilli, resource.DecimalSI),
		}
		if spec.placedGPUs > 0 {
			requests["nvidia.com/gpu"] = *resource.NewQuantity(spec.placedGPUs, resource.DecimalSI)
		}
		ni.AddPod(&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: spec.name + "-resident", Namespace: "default", UID: types.UID(spec.name + "-resident")},
			Spec: corev1.PodSpec{
				NodeName:   spec.name,
				Containers: []corev1.Container{{Name: "app", Resources: corev1.ResourceRequirements{Requests: requests}}},
			},
		})
	}
	return ni
}

// newScorePluginWithNodes wires the plugin to a snapshot containing the given
// nodes, exactly as the scheduler framework does in a real cluster.
func newScorePluginWithNodes(t *testing.T, specs ...mlNodeSpec) (*plugins.MLWorkloadScore, []*framework.NodeInfo) {
	t.Helper()

	nodes := make([]*framework.NodeInfo, 0, len(specs))
	for _, spec := range specs {
		nodes = append(nodes, buildNodeInfo(spec))
	}

	handle := &mockHandle{sharedLister: &mockSharedLister{nodeLister: &mockNodeInfoLister{nodes: nodes}}}
	p, err := plugins.NewMLWorkloadScore(context.Background(), nil, handle)
	if err != nil {
		t.Fatalf("NewMLWorkloadScore: %v", err)
	}
	return p.(*plugins.MLWorkloadScore), nodes
}

// mlTrainingPod requests gpus physical GPUs for an ml-training workload.
func mlTrainingPod(gpus int64) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "trainer",
			Namespace:   "default",
			Annotations: map[string]string{"greenpay.io/workload-type": "ml-training"},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name: "train",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{"nvidia.com/gpu": *resource.NewQuantity(gpus, resource.DecimalSI)},
				},
			}},
		},
	}
}

// scoreAll runs the real PreScore → Score sequence over the whole node set.
func scoreAll(t *testing.T, plugin *plugins.MLWorkloadScore, nodes []*framework.NodeInfo, pod *corev1.Pod) map[string]int64 {
	t.Helper()
	ctx := context.Background()
	state := framework.NewCycleState()

	if status := plugin.PreScore(ctx, state, pod, nodes); !status.IsSuccess() {
		t.Fatalf("PreScore: %v", status.Message())
	}

	scores := make(map[string]int64, len(nodes))
	for _, ni := range nodes {
		name := ni.Node().Name
		score, status := plugin.Score(ctx, state, pod, name)
		if !status.IsSuccess() {
			t.Fatalf("Score(%s): %v", name, status.Message())
		}
		if score < framework.MinNodeScore || score > framework.MaxNodeScore {
			t.Fatalf("Score(%s) = %d, outside [%d, %d]", name, score, framework.MinNodeScore, framework.MaxNodeScore)
		}
		scores[name] = score
	}
	return scores
}

// gpuNodeLabels is a well-formed 8-GPU node with pod-scope NUMA enforcement.
func gpuNodeLabels(overrides map[string]string) map[string]string {
	labels := map[string]string{
		"greenpay.io/gpu-vendor":              "nvidia",
		"greenpay.io/gpu-model":               "a100",
		"greenpay.io/gpu-count":               "8",
		"greenpay.io/gpu-vram-mib":            "81920",
		"greenpay.io/numa-nodes":              "2",
		"greenpay.io/gpu-numa-distribution":   "4.4",
		"greenpay.io/topology-manager-policy": "restricted",
		"greenpay.io/topology-manager-scope":  "pod",
		"greenpay.io/network-bandwidth":       "100",
	}
	for k, v := range overrides {
		labels[k] = v
	}
	return labels
}

// TestScore_SubScoresVaryAcrossRealisticNodeSet is the regression guard for the
// silent no-op: a realistic four-node cluster must produce four different
// scores, ordered by how well each node actually fits the workload. While node
// resolution is broken every one of these is MaxNodeScore/2.
func TestScore_SubScoresVaryAcrossRealisticNodeSet(t *testing.T) {
	specs := []mlNodeSpec{
		{
			// Densely packed, NVLink-class bandwidth, half its GPUs free.
			name:           "gpu-dense",
			labels:         gpuNodeLabels(map[string]string{"greenpay.io/network-bandwidth": "200"}),
			allocatableCPU: 64,
			gpuAllocatable: 8,
			placedCPUMilli: 48000,
			placedGPUs:     4,
		},
		{
			// Nearly full on GPUs (the fragmented zone) and a slow uplink.
			name:           "gpu-fragmented",
			labels:         gpuNodeLabels(map[string]string{"greenpay.io/network-bandwidth": "25"}),
			allocatableCPU: 64,
			gpuAllocatable: 8,
			placedCPUMilli: 8000,
			placedGPUs:     7,
		},
		{
			// Empty of GPUs but its GPUs are spread across four NUMA domains,
			// so a 4-GPU request cannot be kept local to one domain.
			name: "gpu-split-numa",
			labels: gpuNodeLabels(map[string]string{
				"greenpay.io/numa-nodes":            "4",
				"greenpay.io/gpu-numa-distribution": "2.2.2.2",
			}),
			allocatableCPU: 32,
			gpuAllocatable: 8,
			placedCPUMilli: 16000,
		},
		{
			// No GPUs at all.
			name:           "cpu-only",
			labels:         map[string]string{"greenpay.io/network-bandwidth": "10"},
			allocatableCPU: 16,
			placedCPUMilli: 2000,
		},
	}

	plugin, nodes := newScorePluginWithNodes(t, specs...)
	scores := scoreAll(t, plugin, nodes, mlTrainingPod(4))

	neutral := framework.MaxNodeScore / 2
	allNeutral := true
	for _, score := range scores {
		if score != neutral {
			allNeutral = false
		}
	}
	if allNeutral {
		t.Fatalf("every node scored the neutral fallback %d — Score() is not seeing real node data: %v", neutral, scores)
	}

	seen := map[int64]string{}
	for name, score := range scores {
		if other, dup := seen[score]; dup {
			t.Errorf("nodes %q and %q both scored %d; sub-scores are not varying node-to-node (%v)", other, name, score, scores)
		}
		seen[score] = name
	}

	// Ordering follows the sub-score weights: dense+fast beats split-NUMA,
	// which beats a GPU-less node, which beats a fragmented, slow one.
	want := []struct {
		better, worse string
		because       string
	}{
		{"gpu-dense", "gpu-split-numa", "denser packing, single-NUMA fit and double the bandwidth"},
		{"gpu-split-numa", "cpu-only", "usable GPU topology"},
		{"cpu-only", "gpu-fragmented", "the fragmented node sits in the penalised allocation band"},
	}
	for _, w := range want {
		if scores[w.better] <= scores[w.worse] {
			t.Errorf("expected %s (%d) to outscore %s (%d) — %s", w.better, scores[w.better], w.worse, scores[w.worse], w.because)
		}
	}

	// Exact composites, so a silent change in any weight or sub-score is caught.
	for name, want := range map[string]int64{
		"gpu-dense":      75,
		"gpu-split-numa": 63,
		"cpu-only":       41,
		"gpu-fragmented": 31,
	} {
		if scores[name] != want {
			t.Errorf("Score(%s) = %d, want %d (all scores: %v)", name, scores[name], want, scores)
		}
	}
}

// TestScore_EachSubScoreVariesWithNodeData isolates the four dimensions: each
// pair of nodes differs in exactly one input, and the scores must follow it.
func TestScore_EachSubScoreVariesWithNodeData(t *testing.T) {
	tests := []struct {
		name          string
		gpusRequested int64
		higher, lower mlNodeSpec
	}{
		{
			// Bin packing. Both nodes have capacity == allocatable, so the old
			// capacity-minus-allocatable proxy reports zero utilisation for
			// both; only the snapshot's requested totals tell them apart.
			name:          "bin packing follows the pods actually placed on the node",
			gpusRequested: 4,
			higher: mlNodeSpec{
				name: "packed", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
				placedCPUMilli: 24000, placedGPUs: 4,
			},
			lower: mlNodeSpec{
				name: "idle", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
				placedCPUMilli: 1000, placedGPUs: 4,
			},
		},
		{
			name:          "fragmentation follows the GPUs already allocated",
			gpusRequested: 2,
			higher: mlNodeSpec{
				name: "roomy", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
				placedCPUMilli: 8000, placedGPUs: 2,
			},
			lower: mlNodeSpec{
				name: "almost-full", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
				placedCPUMilli: 8000, placedGPUs: 7,
			},
		},
		{
			name:          "NUMA score follows the GPU-per-domain distribution",
			gpusRequested: 4,
			higher: mlNodeSpec{
				name: "one-domain", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
				placedCPUMilli: 8000,
			},
			lower: mlNodeSpec{
				name: "four-domains",
				labels: gpuNodeLabels(map[string]string{
					"greenpay.io/numa-nodes":            "4",
					"greenpay.io/gpu-numa-distribution": "2.2.2.2",
				}),
				allocatableCPU: 32, gpuAllocatable: 8, placedCPUMilli: 8000,
			},
		},
		{
			name:          "bandwidth score follows the uplink label",
			gpusRequested: 4,
			higher: mlNodeSpec{
				name:           "fast-uplink",
				labels:         gpuNodeLabels(map[string]string{"greenpay.io/network-bandwidth": "200"}),
				allocatableCPU: 32, gpuAllocatable: 8, placedCPUMilli: 8000,
			},
			lower: mlNodeSpec{
				name:           "slow-uplink",
				labels:         gpuNodeLabels(map[string]string{"greenpay.io/network-bandwidth": "10"}),
				allocatableCPU: 32, gpuAllocatable: 8, placedCPUMilli: 8000,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plugin, nodes := newScorePluginWithNodes(t, tc.higher, tc.lower)
			scores := scoreAll(t, plugin, nodes, mlTrainingPod(tc.gpusRequested))

			if scores[tc.higher.name] == scores[tc.lower.name] {
				t.Fatalf("both nodes scored %d — this sub-score is not reading node data", scores[tc.higher.name])
			}
			if scores[tc.higher.name] < scores[tc.lower.name] {
				t.Errorf("expected %s (%d) to outscore %s (%d)",
					tc.higher.name, scores[tc.higher.name], tc.lower.name, scores[tc.lower.name])
			}
		})
	}
}

// TestScore_NeutralFallbackOnlyWhenNodeUnresolvable pins the fallback to its
// intended role. The bug was never that MaxNodeScore/2 existed — it was that
// it was the only path ever taken.
func TestScore_NeutralFallbackOnlyWhenNodeUnresolvable(t *testing.T) {
	ctx := context.Background()
	neutral := framework.MaxNodeScore / 2

	resident := mlNodeSpec{
		name: "known-node", labels: gpuNodeLabels(nil), allocatableCPU: 32, gpuAllocatable: 8,
		placedCPUMilli: 24000, placedGPUs: 4,
	}
	plugin, nodes := newScorePluginWithNodes(t, resident)
	pod := mlTrainingPod(4)

	state := framework.NewCycleState()
	if status := plugin.PreScore(ctx, state, pod, nodes); !status.IsSuccess() {
		t.Fatalf("PreScore: %v", status.Message())
	}

	resolved, status := plugin.Score(ctx, state, pod, "known-node")
	if !status.IsSuccess() {
		t.Fatalf("Score(known-node): %v", status.Message())
	}
	if resolved == neutral {
		t.Errorf("a node present in the snapshot scored the neutral fallback %d", neutral)
	}

	// Absent from the snapshot: the fallback is correct here.
	missing, status := plugin.Score(ctx, state, pod, "node-that-was-deleted")
	if !status.IsSuccess() {
		t.Fatalf("Score(missing node) should degrade gracefully, got: %v", status.Message())
	}
	if missing != neutral {
		t.Errorf("Score(missing node) = %d, want the neutral fallback %d", missing, neutral)
	}

	// No handle at all (misconfigured plugin): degrade, never panic.
	p, err := plugins.NewMLWorkloadScore(ctx, nil, nil)
	if err != nil {
		t.Fatalf("NewMLWorkloadScore: %v", err)
	}
	noHandle, status := p.(*plugins.MLWorkloadScore).Score(ctx, framework.NewCycleState(), pod, "known-node")
	if !status.IsSuccess() {
		t.Fatalf("Score without a handle should degrade gracefully, got: %v", status.Message())
	}
	if noHandle != neutral {
		t.Errorf("Score without a handle = %d, want the neutral fallback %d", noHandle, neutral)
	}
}
