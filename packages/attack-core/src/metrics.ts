import type { TraceBundle } from "@clb-acel/verifier-core";

export function estimateStorageBytes(bundle: TraceBundle): number {
  return JSON.stringify(bundle.events).length;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}
