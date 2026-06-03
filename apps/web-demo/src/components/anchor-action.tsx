"use client";

import { useEffect, useState } from "react";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AnchorStatus = {
  traceId: string;
  merkleRoot: string;
  traceHash: string;
  chainId: number;
  contractAddress?: string;
  configured: boolean;
  anchored: boolean;
  readError?: string;
  requirements: Record<string, boolean>;
};

type AnchorResult = {
  status: "ANCHORED" | "PENDING_CONTRACT" | "ANCHOR_FAILED";
  txHash?: string;
  contractAddress?: string;
  traceHash?: string;
  merkleRoot?: string;
  message?: string;
  error?: string;
};

function explorerUrl(chainId: number, txHash: string | undefined) {
  if (!txHash || chainId === 31337) return null;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return null;
}

const REQUIREMENT_LABELS: Record<string, string> = {
  AUDIT_ANCHOR_ADDRESS: "AgenticAuditAnchor contract address",
  RPC_URL: "RPC endpoint",
  DEPLOYER_PRIVATE_KEY: "deployer private key for anchor transactions",
};

export function AnchorAction() {
  const { traceId } = useDemoRun();
  const [status, setStatus] = useState<AnchorStatus | null>(null);
  const [result, setResult] = useState<AnchorResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}/status`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Anchor status unavailable");
        if (!cancelled) setStatus(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Anchor status failed");
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  async function anchorTrace() {
    if (!traceId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok && response.status !== 202) {
        throw new Error(payload.error ?? "Anchor failed");
      }
      setResult(payload);
      const refreshed = await fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}/status`, {
        cache: "no-store",
      }).then((res) => res.json());
      setStatus(refreshed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anchor failed");
    } finally {
      setBusy(false);
    }
  }

  if (!traceId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No trace yet</CardTitle>
          <CardDescription>Complete steps 1-6 before anchoring evidence on-chain.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/verifier" className={buttonVariants()}>
            Go to verifier
          </a>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{error ?? "Loading anchor status..."}</p>;
  }

  const explorer = explorerUrl(status.chainId, result?.txHash);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>On-chain anchor</CardTitle>
            <CardDescription>
              Chain stores only roots and hashes; evidence stays off-chain.
            </CardDescription>
          </div>
          <Badge variant={status.anchored ? "default" : status.configured ? "secondary" : "outline"}>
            {status.anchored ? "Already anchored" : status.configured ? "Ready" : "Pending contract"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Trace ID</span>
            <p className="mt-1 font-mono text-xs break-all">{status.traceId}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Merkle root</span>
            <p className="mt-1 font-mono text-xs break-all">{status.merkleRoot}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Trace hash</span>
            <p className="mt-1 font-mono text-xs break-all">{status.traceHash}</p>
          </div>
          <div>
            <span className="text-muted-foreground">AgenticAuditAnchor</span>
            <p className="mt-1 font-mono text-xs break-all">
              {status.contractAddress ?? "Not configured"}
            </p>
          </div>
        </div>

        {!status.configured ? (
          <div className="space-y-3 rounded-lg border border-dashed p-3 text-sm">
            <div>
              <p className="font-medium">Anchor contract setup</p>
              <p className="mt-1 text-muted-foreground">
                Deploy `AgenticAuditAnchor`, then copy the printed address into `.env` as
                `AUDIT_ANCHOR_ADDRESS`.
              </p>
            </div>
            <div className="grid gap-1 font-mono text-xs">
              {Object.entries(status.requirements).map(([key, ok]) => (
                <p key={key} className={ok ? "text-emerald-600" : "text-destructive"}>
                  {ok ? "set" : "missing"} {key}
                  <span className="font-sans text-muted-foreground">
                    {" "}
                    - {REQUIREMENT_LABELS[key] ?? key}
                  </span>
                </p>
              ))}
            </div>
            <div className="space-y-2 rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
              <p>docker compose up -d anvil</p>
              <p>cd contracts && forge script script/Deploy.s.sol --rpc-url anvil --broadcast --private-key 0xac0974...</p>
              <p>AUDIT_ANCHOR_ADDRESS=0x... # copy AgenticAuditAnchor output</p>
              <p>DEPLOYER_PRIVATE_KEY=0xac0974... # same local Anvil deployer key</p>
            </div>
            <p className="text-xs text-muted-foreground">
              If Anvil restarts, redeploy the contract and replace the address; local chain state is wiped.
            </p>
          </div>
        ) : null}

        <Button disabled={busy || status.anchored} onClick={() => void anchorTrace()}>
          {busy ? "Anchoring..." : status.anchored ? "Already anchored" : "Anchor trace"}
        </Button>

        {result ? (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <Badge>{result.status}</Badge>
            {result.txHash ? (
              <p className="font-mono text-xs break-all">
                <span className="text-muted-foreground">tx: </span>
                {explorer ? <a className="underline" href={explorer} target="_blank">{result.txHash}</a> : result.txHash}
              </p>
            ) : null}
            {result.message ? <p className="text-muted-foreground">{result.message}</p> : null}
            {result.error ? <p className="text-destructive">{result.error}</p> : null}
          </div>
        ) : null}
        {status.readError ? <p className="text-sm text-muted-foreground">{status.readError}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
