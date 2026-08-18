package plugins_test

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/kubernetes/pkg/scheduler/framework"

	"github.com/greenpay/scheduler/pkg/plugins"
)

func newScorePlugin(t *testing.T) *plugins.MLWorkloadScore {
	t.Helper()
	p, err := plugins.NewMLWorkloadScore(nil, nil)
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
