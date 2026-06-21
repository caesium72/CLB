"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ExternalLink, Eye, EyeOff, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BASE_SEPOLIA_CHAIN_ID, DEMO_MERCHANT_WALLET, addressUrl, txUrl } from "@/lib/explorer";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Result = {
  valid: boolean;
  amount: string;
  maxValue: string;
  payee: string;
  onchain: { commitment: string; payeeCommitment: string; rangeProofBits: number };
};

function short(value: string, head = 12, tail = 8): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right", mono && "font-mono text-xs")} title={value}>
        {value}
      </span>
    </div>
  );
}

export default function PrivacyLabPage() {
  const [form, setForm] = useState({
    amount: "2.00",
    maxValue: "5.00",
    payee: "0x54Db78Db972b6e153d918e49758CB0D0265b5e4E",
  });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const { traceId } = useDemoRun();
  const [exposure, setExposure] = useState<{
    txUrl: string;
    value: string;
    asset: string;
    from: string;
    payTo: string;
  } | null>(null);
  const [anchor, setAnchor] = useState<{
    merkleRoot?: string;
    contractAddress?: string | null;
    anchored?: boolean;
    txHash?: string;
  } | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/trace/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((trace) => {
        if (cancelled) return;
        const chainId = trace?.settlementDescriptor?.chainId ?? trace?.concreteSettlement?.chainId;
        const txHash = trace?.settlement?.txHash;
        if (chainId === BASE_SEPOLIA_CHAIN_ID && txHash) {
          setExposure({
            txUrl: txUrl(txHash),
            value: trace.settlement.value,
            asset: trace.settlement.asset,
            from: trace.settlement.payer,
            payTo: trace.settlement.payTo,
          });
        }
      })
      .catch(() => undefined);
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

  async function publishCommitment() {
    if (!traceId) return;
    setAnchoring(true);
    setAnchorError(null);
    try {
      const response = await fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Anchor failed");
      setAnchor((current) => ({ ...current, ...payload, anchored: true }));
    } catch (cause) {
      setAnchorError(cause instanceof Error ? cause.message : "Anchor failed");
    } finally {
      setAnchoring(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    setRevealed(false);
    try {
      const response = await fetch("/api/demo/confidential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Confidential proof failed");
      setResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Confidential proof failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <Card>
        <CardHeader>
          <CardTitle>Verify a payment without revealing it</CardTitle>
          <CardDescription>
            A real-world USDC payment leaks metadata — the ERC-20 Transfer event exposes payee and
            amount. CLB-ACEL instead publishes a commitment plus a range proof that{" "}
            <span className="font-mono">value ≤ budget</span>, and the deterministic verifier returns
            PASS without ever learning the amount or payee. This is the off-chain commit-and-prove
            primitive (<span className="font-mono">clb-core</span>) — try it below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (hidden)</Label>
              <Input
                id="amount"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxValue">Signed budget (public)</Label>
              <Input
                id="maxValue"
                value={form.maxValue}
                onChange={(event) => setForm((current) => ({ ...current, maxValue: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payee">Payee (hidden)</Label>
              <Input
                id="payee"
                value={form.payee}
                onChange={(event) => setForm((current) => ({ ...current, payee: event.target.value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="button" disabled={busy} className="gap-1.5" onClick={() => void commit()}>
              <Sparkles className="size-4" />
              {busy ? "Proving…" : "Commit & prove"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Tip: set the amount above the budget to watch the proof fail while the amount stays hidden.
            </span>
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="size-5 text-muted-foreground" />
            What this run actually put on Base Sepolia
          </CardTitle>
          <CardDescription>
            Two real transactions from your run. Neither publishes the amount in cleartext — this demo
            settles via a commitment marker, not a USDC transfer. The remaining metadata leak is the
            payee, which the confidential path above also commits. Open them and decode the input.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Settlement marker — payee visible, amount committed */}
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2">
                <Eye className="size-4 text-amber-600" />
                <p className="text-sm font-semibold">x402 settlement marker</p>
              </div>
              {exposure ? (
                <>
                  <div className="mt-2 space-y-0.5">
                    <Row label="to (payee)" value={short(exposure.payTo)} />
                    <Row label="value" value="0 ETH · no USDC transfer" mono={false} />
                    <Row label="input" value="keccak256(auth) — 32-byte digest" mono={false} />
                  </div>
                  <p className="mt-1.5 text-[0.7rem] text-amber-700">
                    Leaks the <strong>payee</strong> (the tx recipient). The amount is committed inside
                    the digest, not readable on-chain.
                  </p>
                  {exposure.from?.toLowerCase() === exposure.payTo?.toLowerCase() ? (
                    <p className="mt-1 text-[0.7rem] text-muted-foreground">
                      Here the recipient also equals the payer — the demo&apos;s weather &amp; shopping
                      agents share one testnet wallet. Run a grammar task for a distinct payee.
                    </p>
                  ) : null}
                  <a
                    href={exposure.txUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 gap-1.5")}
                  >
                    Open settlement tx <ExternalLink className="size-3.5" />
                  </a>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Run a checkout to produce your own settlement marker and decode its input here.
                  </p>
                  <a
                    href={addressUrl(DEMO_MERCHANT_WALLET)}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 gap-1.5")}
                  >
                    Open merchant wallet <ExternalLink className="size-3.5" />
                  </a>
                </>
              )}
            </div>

            {/* CLB-ACEL anchor — commitment only */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <EyeOff className="size-4 text-primary" />
                <p className="text-sm font-semibold">CLB-ACEL evidence anchor</p>
              </div>
              {anchor?.merkleRoot ? (
                <div className="mt-2 space-y-0.5">
                  <Row label="trace root (Merkle)" value={short(anchor.merkleRoot)} />
                  <Row label="amount" value="— not on-chain —" mono={false} />
                  <Row label="payee" value="— not on-chain —" mono={false} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Run a checkout first to build a trace whose commitment can be anchored.
                </p>
              )}
              <p className="mt-1.5 text-[0.7rem] text-primary/80">
                Publishes only the trace&apos;s Merkle root — no payee, no amount.
              </p>
              {anchor?.txHash ? (
                <a
                  href={txUrl(anchor.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 gap-1.5")}
                >
                  Open anchor tx <ExternalLink className="size-3.5" />
                </a>
              ) : anchor?.anchored && anchor.contractAddress ? (
                <a
                  href={addressUrl(anchor.contractAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 gap-1.5")}
                >
                  Already anchored — open contract <ExternalLink className="size-3.5" />
                </a>
              ) : anchor?.merkleRoot ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-1.5"
                  disabled={anchoring}
                  onClick={() => void publishCommitment()}
                >
                  <Lock className="size-3.5" />
                  {anchoring ? "Publishing on-chain…" : "Publish commitment on-chain"}
                </Button>
              ) : null}
              {anchorError ? <p className="mt-1 text-[0.7rem] text-destructive">{anchorError}</p> : null}
            </div>
          </div>
          <p className="mt-3 text-[0.7rem] text-muted-foreground">
            Honest note: this demo never settles real USDC — the x402 step writes a 0-value commitment
            marker, so the amount is already off-chain. A production USDC payment (EIP-3009
            <span className="font-mono"> transferWithAuthorization</span>) would additionally expose the
            amount in an ERC-20 Transfer event; the confidential commit-and-prove above is what keeps
            that amount private while still provably <span className="font-mono">≤ budget</span>.
          </p>
        </CardContent>
      </Card>

      {result ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-primary/30">
              <CardHeader>
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Eye className="size-5" />
                </div>
                <CardTitle className="mt-3">Public commitment</CardTitle>
                <CardDescription>
                  What you&apos;d publish instead of the cleartext payment (computed here by{" "}
                  <span className="font-mono">clb-core</span>, not yet wired to the settlement tx)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-0.5">
                <Row label="commitment" value={short(result.onchain.commitment)} />
                <Row label="payeeCommitment" value={short(result.onchain.payeeCommitment)} />
                <Row label="rangeProof" value={`${result.onchain.rangeProofBits}-bit (value ≤ budget)`} mono={false} />
                <Row label="budget" value={`${result.maxValue} USDC`} mono={false} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <EyeOff className="size-5" />
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setRevealed((value) => !value)}>
                    {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {revealed ? "Hide" : "Reveal"}
                  </Button>
                </div>
                <CardTitle className="mt-3">Encrypted off-chain</CardTitle>
                <CardDescription>Never published — kept in a selective-disclosure blob</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <div className={cn("space-y-0.5 transition", !revealed && "blur-sm select-none")}>
                    <Row label="amount" value={`${result.amount} USDC`} mono={false} />
                    <Row label="payee" value={result.payee} />
                  </div>
                  {!revealed ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <Lock className="size-5 text-muted-foreground" />
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          <motion.div
            key={`${result.valid}-${result.amount}-${result.maxValue}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className={cn(result.valid ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className={cn("size-5", result.valid ? "text-emerald-600" : "text-destructive")} />
                  Verifier: {result.valid ? "PASS" : "FAIL"}
                  <Badge variant="outline">no amount revealed</Badge>
                </CardTitle>
                <CardDescription className="text-foreground/80">
                  {result.valid
                    ? "The range proof shows the hidden amount is within the signed budget — verified without learning the amount or payee."
                    : "The hidden amount exceeds the signed budget, so the range proof fails — caught even though the amount and payee stay encrypted."}
                </CardDescription>
              </CardHeader>
            </Card>
          </motion.div>
        </>
      ) : null}
    </div>
  );
}
