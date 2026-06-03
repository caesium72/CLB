"use client";

import { ShieldCheck } from "lucide-react";

export function EvidenceMerkleBanner({ merkleRoot, eventCount }: { merkleRoot: string; eventCount: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-700" />
        <p className="text-sm font-medium text-emerald-900">Merkle commitment over {eventCount} events</p>
      </div>
      <p className="font-mono text-xs text-emerald-800 break-all sm:max-w-[60%] sm:text-right">{merkleRoot}</p>
    </div>
  );
}
