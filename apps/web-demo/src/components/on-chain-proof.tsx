"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BASE_SEPOLIA_CHAIN_ID,
  CANONICAL_REGISTRY_ADDRESS,
  addressUrl,
  agentUrl,
  isOnChainAgentId,
  registryUrl,
  txUrl,
} from "@/lib/explorer";
import { cn } from "@/lib/utils";

type Trace = {
  settlement?: { txHash?: string; payTo?: string; payer?: string };
  payerAgent?: { agentId?: string };
  merchantAgent?: { agentId?: string };
  settlementDescriptor?: { chainId?: number };
  concreteSettlement?: { chainId?: number; payTo?: string };
};

type Record = {
  label: string;
  hint: string;
  value: string;
  href: string | null;
  explorer: "BaseScan" | "8004scan";
};

function short(value: string, head = 10, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

type Anchor = {
  anchored?: boolean;
  configured?: boolean;
  merkleRoot?: string;
  contractAddress?: string | null;
};

export function OnChainProof({ traceId }: { traceId?: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/trace/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Trace not found");
        if (!cancelled) setTrace(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load trace");
      });
    fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}/status`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled && !("error" in payload)) setAnchor(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  const chainId = trace?.settlementDescriptor?.chainId ?? trace?.concreteSettlement?.chainId;
  const onBaseSepolia = chainId === BASE_SEPOLIA_CHAIN_ID;
  const payTo = trace?.settlement?.payTo ?? trace?.concreteSettlement?.payTo;
  const merchantId = trace?.merchantAgent?.agentId;

  const records: Record[] = [];
  if (trace?.settlement?.txHash) {
    records.push({
      label: "Settlement payment",
      hint: "The real x402 payment transaction",
      value: trace.settlement.txHash,
      href: onBaseSepolia ? txUrl(trace.settlement.txHash) : null,
      explorer: "BaseScan",
    });
  }
  if (anchor?.merkleRoot && anchor.contractAddress) {
    records.push({
      label: anchor.anchored ? "Evidence anchor ✓" : "Evidence anchor",
      hint: anchor.anchored
        ? "This trace's Merkle root is committed on-chain — the binding proof"
        : "Merkle root of the trace; anchored on-chain when you leave feedback",
      value: anchor.merkleRoot,
      href: onBaseSepolia ? addressUrl(anchor.contractAddress) : null,
      explorer: "BaseScan",
    });
  }
  if (merchantId && isOnChainAgentId(merchantId)) {
    records.push({
      label: "Merchant agent identity",
      hint: "The paid agent's ERC-8004 record",
      value: `#${merchantId}`,
      href: agentUrl(merchantId),
      explorer: "8004scan",
    });
  }
  if (payTo) {
    records.push({
      label: "Merchant wallet",
      hint: "Who received the payment",
      value: payTo,
      href: onBaseSepolia ? addressUrl(payTo) : null,
      explorer: "BaseScan",
    });
  }
  records.push({
    label: "ERC-8004 Identity Registry",
    hint: "Where both agents are registered",
    value: CANONICAL_REGISTRY_ADDRESS,
    href: registryUrl(),
    explorer: "BaseScan",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>On-chain proof</CardTitle>
        <CardDescription>
          {onBaseSepolia
            ? "Open the real records this run produced on Base Sepolia — don't take our word for it."
            : "Live explorer links resolve when the run settles on Base Sepolia (chain 84532)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {records.map((record) => (
          <div
            key={record.label}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold">{record.label}</p>
              <p className="text-xs text-muted-foreground">{record.hint}</p>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground" title={record.value}>
                {short(record.value)}
              </p>
            </div>
            {record.href ? (
              <a
                href={record.href}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1.5")}
              >
                View on {record.explorer} <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">local run</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
