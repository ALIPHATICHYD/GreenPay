// Binary greenpay-scheduler is a custom Kubernetes scheduler built on top of
// the upstream scheduler-plugins framework.  It extends the default scheduler
// with two GreenPay-specific plugins:
//
//   - GPUHardwareFilter — hard-constraint filter for GPU/TPU hardware matching
//   - MLWorkloadScore   — composite scoring for ML workload bin-packing
//
// The binary is a drop-in replacement for kube-scheduler and accepts the same
// flags and configuration file format.  The only addition is the plugin
// registration before the scheduler is started.
//
// # Running
//
//	greenpay-scheduler \
//	  --config=/etc/kubernetes/greenpay-scheduler-config.yaml \
//	  --v=4
//
// The scheduler config references the plugins by name in
// KubeSchedulerProfile.plugins sections.
package main

import (
	"math/rand"
	"os"
	"time"

	"k8s.io/component-base/cli"
	_ "k8s.io/component-base/logs/json/register" // register JSON log format
	"k8s.io/klog/v2"
	"k8s.io/kubernetes/cmd/kube-scheduler/app"
	"k8s.io/kubernetes/pkg/scheduler/framework/runtime"

	"github.com/greenpay/scheduler/pkg/plugins"
)

func main() {
	// Seed the global random source — the scheduler framework uses it for
	// jitter in backoff loops.
	rand.Seed(time.Now().UnixNano()) //nolint:staticcheck // pre-Go1.20 compat

	// Build the out-of-tree plugin registry.
	outOfTreeRegistry := runtime.Registry{}
	if err := plugins.RegisterPlugins(outOfTreeRegistry); err != nil {
		klog.ErrorS(err, "Failed to register GreenPay scheduler plugins")
		os.Exit(1)
	}

	// Build the scheduler command with our additional plugin registry.
	// scheduler-plugins' WithPlugin merges our registry into the default one.
	command := app.NewSchedulerCommand(
		app.WithPlugin(outOfTreeRegistry),
	)

	// cli.Run handles flag parsing, signal handling, and os.Exit.
	code := cli.Run(command)
	os.Exit(code)
}
