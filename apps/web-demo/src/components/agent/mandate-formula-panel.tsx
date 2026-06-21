"use client";

import { computeMandateDigest, deriveNonce } from "@clb-acel/clb-core";
import type { Mandate } from "@clb-acel/schemas";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowDown, ExternalLink, Fingerprint, PenLine, Play, ShieldCheck, Wallet } from "lucide-react";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { agentUrl, isOnChainAgentId } from "@/lib/explorer";
import { MODE_THEME } from "@/lib/mode-theme";
import { cn } from "@/lib/utils";

type Prepared = {
  mode?: "a" | "b";
  payerAgent?: { agentId: string; registryAddr: string; chainId: number };
  settlementDescriptor?: {
    chainId: number;
    network: string;
    asset: string;
    payTo: string;
    value: string;
    validBefore: string;
    x402Scheme: string;
  };
  predicateDescriptor?: {
    predicateId: string;
    predicate: {
      maxValue: string;
      allowedAssets: string[];
      allowedPayees: string[];
      validUntil: string;
    };
  };
  mandateDraft?: {
    mandateId?: string;
    type?: string;
    humanPrincipal?: string;
    constraints?: { maxAmount?: string; validUntil?: string };
  };
  mandateDigest?: string;
  expectedCommitment?: string;
};

function short(value: string | undefined, head = 10, tail = 8): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function Hash({ value, className }: { value?: string; className?: string }) {
  return (
    <span title={value} className={cn("font-mono text-xs break-all", className)}>
      {short(value)}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs">{children}</span>
    </div>
  );
}

/** One reveal-staggered block in the build pipeline. Keyed by runId to replay. */
function Step({
  runId,
  index,
  reduce,
  children,
}: {
  runId: number;
  index: number;
  reduce: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={`${runId}-${index}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : index * 0.35, duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

function FoldArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-1 text-muted-foreground">
      <ArrowDown className="size-4 shrink-0" />
      <span className="font-mono text-[0.7rem]">{label}</span>
    </div>
  );
}

function IngredientCard({
  icon: Icon,
  name,
  plain,
  children,
}: {
  icon: typeof Fingerprint;
  name: string;
  plain: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-semibold">{name}</span>
        <span className="ml-auto text-xs text-muted-foreground">{plain}</span>
      </div>
      <div className="space-y-0.5 border-t border-border/60 pt-2">{children}</div>
    </div>
  );
}

export function MandateFormulaPanel({ mode }: { mode: "a" | "b" }) {
  const { intentId, intent } = useDemoRun();
  const theme = MODE_THEME[mode];
  const reduce = useReducedMotion();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (!intentId) return;
    let cancelled = false;
    setError(null);
    fetch("/api/demo/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, intent, mode }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not build the commitment");
        if (!cancelled) {
          setPrepared(payload);
          setRunId((id) => id + 1);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Commitment build failed");
      });
    return () => {
      cancelled = true;
    };
  }, [intentId, intent, mode]);

  const identity = prepared?.payerAgent;
  const mandateDigest =
    prepared?.mandateDigest ??
    (prepared?.mandateDraft ? safeMandateDigest(prepared.mandateDraft as unknown as Mandate) : undefined);
  const commitment = prepared?.expectedCommitment;
  const nonce = commitment ? safeNonce(commitment) : undefined;
  const isB = mode === "b";

  return (
    <Card className={cn(theme.accentBorder)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Building the commitment</CardTitle>
            <CardDescription>
              {isB
                ? "Your one signature authorizes a spending predicate. The agent fills concrete settlement params later — the verifier (R17) checks them against this."
                : "Your one signature binds three layers into a single value C. The payment nonce is H(C), so it can pay exactly once, exactly here."}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!prepared}
            onClick={() => setRunId((id) => id + 1)}
          >
            <Play className="size-3.5" /> Replay
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !prepared ? (
          <p className="text-sm text-muted-foreground">Computing the commitment from your intent…</p>
        ) : (
          <div className="space-y-1">
            <Step runId={runId} index={0} reduce={reduce}>
              <IngredientCard icon={Fingerprint} name="identityRef" plain="Who the agent is">
                <Field label="agentId">
                  {!identity ? (
                    "—"
                  ) : isOnChainAgentId(identity.agentId) ? (
                    <a
                      href={agentUrl(identity.agentId)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono underline underline-offset-2"
                    >
                      #{identity.agentId} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span
                      className="font-mono"
                      title="The buyer's own shopping agent — a local demo identity, not a marketplace listing"
                    >
                      {identity.agentId}
                    </span>
                  )}
                </Field>
                <Field label="registryAddr">
                  <Hash value={identity?.registryAddr} />
                </Field>
                <Field label="chainId">
                  <span className="font-mono">{identity?.chainId}</span>
                </Field>
              </IngredientCard>
            </Step>

            <Step runId={runId} index={1} reduce={reduce}>
              <IngredientCard icon={PenLine} name="mandateDigest" plain="What the human signed">
                <p className="mb-2 text-[0.7rem] leading-relaxed text-muted-foreground">
                  A <span className="font-medium">mandate</span> is your signed authorization (AP2).{" "}
                  {isB
                    ? "An INTENT mandate approves a spending rule, not an amount."
                    : "A CART mandate approves this exact purchase."}
                </p>
                <Field label="type">
                  <span className="font-mono">
                    {prepared.mandateDraft?.type ?? (isB ? "INTENT" : "CART")}{" "}
                    <span className="text-muted-foreground">— {isB ? "spending rule" : "exact cart"}</span>
                  </span>
                </Field>
                <Field label="humanPrincipal · your wallet">
                  <Hash value={prepared.mandateDraft?.humanPrincipal} />
                </Field>
                <Field label="authorizedAgent · who you delegated to">
                  <span className="font-mono">{identity ? `#${identity.agentId}` : "—"}</span>
                </Field>
                <Field label={isB ? "maxAmount · spending cap" : "amount · exact"}>
                  <span className="font-mono">{prepared.mandateDraft?.constraints?.maxAmount ?? "—"}</span>
                </Field>
                <div className="mt-2 rounded-md bg-background px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[0.7rem] text-muted-foreground">keccak256(AP2 fields) =</span>
                    <Hash value={mandateDigest} className={theme.accentText} />
                  </div>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">
                    AP2 fields = mandateId, type, humanPrincipal, authorizedAgent, constraints
                  </p>
                </div>
              </IngredientCard>
            </Step>

            <Step runId={runId} index={2} reduce={reduce}>
              {isB ? (
                <IngredientCard icon={ShieldCheck} name="spendingPredicate" plain="The limits, not an amount">
                  <Field label="maxValue">
                    <span className="font-mono">
                      {prepared.predicateDescriptor?.predicate.maxValue}{" "}
                      {prepared.predicateDescriptor?.predicate.allowedAssets?.[0]}
                    </span>
                  </Field>
                  <Field label="allowedPayees">
                    <Hash value={prepared.predicateDescriptor?.predicate.allowedPayees?.[0]} />
                  </Field>
                  <Field label="validUntil">
                    <span className="font-mono">{prepared.predicateDescriptor?.predicate.validUntil?.slice(0, 10)}</span>
                  </Field>
                  <Field label="predicateId">
                    <span className="font-mono">{prepared.predicateDescriptor?.predicateId}</span>
                  </Field>
                </IngredientCard>
              ) : (
                <IngredientCard icon={Wallet} name="settlementDescriptor" plain="The exact payment">
                  <Field label="value">
                    <span className="font-mono">
                      {prepared.settlementDescriptor?.value} {prepared.settlementDescriptor?.asset}
                    </span>
                  </Field>
                  <Field label="payTo">
                    <Hash value={prepared.settlementDescriptor?.payTo} />
                  </Field>
                  <Field label="chainId">
                    <span className="font-mono">{prepared.settlementDescriptor?.chainId}</span>
                  </Field>
                  <Field label="validBefore">
                    <span className="font-mono">{prepared.settlementDescriptor?.validBefore?.slice(0, 19)}Z</span>
                  </Field>
                </IngredientCard>
              )}
            </Step>

            <Step runId={runId} index={3} reduce={reduce}>
              <FoldArrow
                label={
                  isB
                    ? "C′ = keccak256( EIP712( identityRef, mandateDigest, predicateId, settlementParamsDigest ) )"
                    : "C = keccak256( EIP712( identityRef, mandateDigest, settlementDescriptor ) )"
                }
              />
            </Step>

            <Step runId={runId} index={4} reduce={reduce}>
              <div className={cn("rounded-lg border p-3", theme.accentBorder, theme.accentBg)}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("font-mono text-sm font-semibold", theme.accentText)}>
                    {isB ? "C′" : "C"} — the binding
                  </span>
                  {isB ? (
                    <Badge variant="outline" className="text-[0.7rem]">
                      filled at settlement
                    </Badge>
                  ) : (
                    <Hash value={commitment} className={theme.accentText} />
                  )}
                </div>
                {isB ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    The agent supplies the concrete <span className="font-mono">settlementParamsDigest</span> at pay
                    time; R17 verifies it satisfies the predicate above.
                  </p>
                ) : null}
              </div>
            </Step>

            <Step runId={runId} index={5} reduce={reduce}>
              <FoldArrow label={isB ? "nonce = H(C′)" : "nonce = H(C)"} />
            </Step>

            <Step runId={runId} index={6} reduce={reduce}>
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">nonce</span>
                  {isB ? (
                    <Badge variant="outline" className="text-[0.7rem]">
                      derived at settlement
                    </Badge>
                  ) : (
                    <Hash value={nonce} />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pins this payment to this commitment — one nonce, one settlement. Replay or redirect breaks the
                  match and the verifier rejects it.
                </p>
              </div>
            </Step>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function safeMandateDigest(mandate: Mandate): string | undefined {
  try {
    return computeMandateDigest(mandate);
  } catch {
    return undefined;
  }
}

function safeNonce(commitment: string): string | undefined {
  try {
    return deriveNonce(commitment as `0x${string}`);
  } catch {
    return undefined;
  }
}
