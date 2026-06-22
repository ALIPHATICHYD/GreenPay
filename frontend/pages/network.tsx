/**
 * pages/network.tsx
 * On-chain transaction network — WebGL visualization of wallet-to-wallet
 * donation and escrow flows across the platform.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import { fetchTransactionGraph, type TransactionGraph } from "@/lib/api";

const TransactionGraphVisualizerNoSSR = dynamic(
  () => import("@/components/TransactionGraphVisualizer"),
  { ssr: false },
);

export default function NetworkPage() {
  const [graph, setGraph] = useState<TransactionGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTransactionGraph()
      .then(setGraph)
      .catch((e: unknown) => setError((e as Error).message || "Failed to load network graph"));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f0a] text-white">
      <Head>
        <title>Transaction Network | Stellar GreenPay</title>
        <meta name="description" content="Explore the on-chain flow of donations and escrow releases across the platform." />
      </Head>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-display font-bold mb-1">On-Chain Transaction Network</h1>
        <p className="text-sm text-forest-300 mb-6">
          Each node is a wallet address; each line is a donation (green) or an escrow release (purple).
          Drag to rotate, scroll to zoom, hover or click a node for details.
        </p>

        {error && <p className="text-red-400">{error}</p>}
        {!error && !graph && <p className="text-forest-300">Loading network graph…</p>}
        {graph && <TransactionGraphVisualizerNoSSR nodes={graph.nodes} edges={graph.edges} />}
      </div>
    </div>
  );
}
