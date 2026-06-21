"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Radio, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PREDICATE_ATTACK_LABELS } from "@clb-acel/attack-core";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useResearchMode } from "@/components/research-mode-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BaselineMatrixSection,
  type BaselineId,
  type BaselineMatrixRow,
  type BaselineOutcome,
} from "./components/baseline-matrix-section";
import {
  PredicateAnatomyPanel,
  type PredicateAttackAnatomy,
} from "./components/predicate-anatomy-panel";
import { PreventionLayerBadge } from "./components/prevention-layer-badge";
import { AttackRunButton } from "./components/attack-run-button";

type PredicateAttackId =
  | "PREDICATE_HAPPY_PATH"
  | "PREDICATE_PAYEE_VIOLATION"
  | "PREDICATE_AMOUNT_VIOLATION"
  | "PREDICATE_ASSET_VIOLATION"
  | "PREDICATE_EXPIRED";

type PredicateAttackRunResult = {
  attackId: PredicateAttackId;
  label: string;
  traceId: string;
  description: string;
  verification: { result: { status: "PASS" | "FAIL"; failedRules: string[] } };
  expectedFailedRules: string[];
  matched: boolean;
  preventionLayer: "predicate-guard" | "verifier" | "none";
  guardPrevented: boolean;
  anatomy: PredicateAttackAnatomy;
  baselineComparison: Record<BaselineId, BaselineOutcome>;
  metrics: { verifyLatencyMs: number; eventCount: number; storageBytesEstimate: number };
};

const FIXTURES: Array<{ id: PredicateAttackId; description: string }> = [
  { id: "PREDICATE_HAPPY_PATH", description: "The agent stays inside every spending rule you signed." },
  { id: "PREDICATE_PAYEE_VIOLATION", description: "The agent tries to pay a merchant you never approved." },
  { id: "PREDICATE_AMOUNT_VIOLATION", description: "The agent tries to spend more than your signed cap." },
  { id: "PREDICATE_ASSET_VIOLATION", description: "The agent tries to pay with a token you did not allow." },
  { id: "PREDICATE_EXPIRED", description: "The agent settles after your authorization deadline." },
];

type LiveRejection = {
  available: boolean;
  attackId?: PredicateAttackId;
  reverted?: boolean;
  asExpected?: boolean;
  txHash?: string;
  reason?: string;
  url?: string;
  detail?: string;
  note?: string;
  error?: string;
};

export function PredicateAttackRunner({ serviceUrl }: { serviceUrl: string }) {
  const { enabled: research } = useResearchMode();
  const [selected, setSelected] = useState<PredicateAttackId>("PREDICATE_AMOUNT_VIOLATION");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PredicateAttackRunResult | null>(null);
  const [onchain, setOnchain] = useState<LiveRejection | null>(null);
  const [onchainRunning, setOnchainRunning] = useState(false);
  const [matrix, setMatrix] = useState<Partial<
    Record<PredicateAttackId, Record<BaselineId, BaselineOutcome>>
  > | null>(null);
  const [status, setStatus] = useState("Scenarios run in-process — deterministic, fixed seed.");

  useEffect(() => {
    let cancelled = false;
    fetch(`${serviceUrl}/attacks/predicate`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then(() => {
        if (!cancelled) {
          setStatus("Scenarios run in-process — deterministic, fixed seed.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("Using fixture metadata fallback.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [serviceUrl]);

  const selectedDescription = useMemo(
    () => FIXTURES.find((fixture) => fixture.id === selected)?.description ?? "",
    [selected],
  );

  const matrixRows: BaselineMatrixRow[] = useMemo(
    () =>
      FIXTURES.map((fixture) => ({
        id: fixture.id,
        label: PREDICATE_ATTACK_LABELS[fixture.id],
        highlight: result?.attackId === fixture.id || (!result && selected === fixture.id),
      })),
    [result, selected],
  );

  async function run() {
    setRunning(true);
    setStatus(`Running ${PREDICATE_ATTACK_LABELS[selected]}...`);
    try {
      const response = await fetch(`${serviceUrl}/attacks/predicate/${selected}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(`Attack simulator responded ${response.status}`);
      }
      const payload = (await response.json()) as PredicateAttackRunResult;
      setResult(payload);
      setMatrix((current) => ({
        ...(current ?? ({} as Record<PredicateAttackId, Record<BaselineId, BaselineOutcome>>)),
        [payload.attackId]: payload.baselineComparison,
      }));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const anatomySection = document.getElementById("predicate-attack-anatomy");
          if (!anatomySection) {
            return;
          }
          history.replaceState(null, "", "#predicate-attack-anatomy");
          anatomySection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      setStatus(payload.matched ? "Result matched expectation" : "Result did not match expectation");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scenario run failed");
    } finally {
      setRunning(false);
    }
  }

  async function runOnChain() {
    setOnchainRunning(true);
    setOnchain(null);
    try {
      const response = await fetch(`${serviceUrl}/attacks/predicate/run-onchain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attackId: selected }),
      });
      setOnchain((await response.json()) as LiveRejection);
    } catch (error) {
      setOnchain({
        available: true,
        error: error instanceof Error ? error.message : "live rejection failed",
      });
    } finally {
      setOnchainRunning(false);
    }
  }

  const pass = result?.verification.result.status === "PASS";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Agent-delegated spending
                {research ? <Badge variant="outline">Mode B · P5</Badge> : null}
              </CardTitle>
              <CardDescription>{status}</CardDescription>
            </div>
            <AttackRunButton loading={running} onClick={run} label="Run scenario" />
          </div>
        </CardHeader>
        <CardContent className="@container/card space-y-5">
          <div className="grid grid-cols-1 gap-2 @sm/card:grid-cols-2 @2xl/card:grid-cols-3">
            {FIXTURES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                aria-pressed={selected === fixture.id}
                onClick={() => setSelected(fixture.id)}
                className={cn(
                  "flex min-h-18 min-w-0 w-full flex-col gap-1 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected === fixture.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <span className="line-clamp-2 text-sm font-semibold leading-snug">
                  {PREDICATE_ATTACK_LABELS[fixture.id]}
                </span>
                {research ? (
                  <span className="line-clamp-1 break-all font-mono text-xs text-muted-foreground">
                    {fixture.id}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 @2xl/card:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div className="min-w-0 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{PREDICATE_ATTACK_LABELS[selected]}</p>
                  {research ? (
                    <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                      {selected}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {selectedDescription}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {selected === "PREDICATE_HAPPY_PATH" ? "Expected: allowed" : "Expected: blocked"}
                    </Badge>
                    {research && selected !== "PREDICATE_HAPPY_PATH" ? (
                      <Badge variant="secondary">R17_PREDICATE_TRUE_FOR_MODE_B</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-border p-4">
              <p className="text-sm font-semibold">Latest result</p>
              {result ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    {pass ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    )}
                    <span className="font-medium">
                      {pass ? "Allowed (within rules)" : "Blocked"}
                    </span>
                  </div>
                  <PreventionLayerBadge layer={result.preventionLayer} />
                  {research ? (
                    <p className="break-words text-muted-foreground">
                      Failed rules: {result.verification.result.failedRules.join(", ") || "none"}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No scenario run yet.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-600/40">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-600" />
                Prevented in-protocol — on Base Sepolia
              </CardTitle>
              <CardDescription>
                Not a simulation: this force-broadcasts the selected scenario through the deployed{" "}
                <span className="font-mono">PredicatePaymentGuard</span>. A rule violation is mined and{" "}
                <span className="font-medium">reverts</span> with its own error; the happy path is allowed —
                either way a real tx you can open on BaseScan.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-1.5"
              disabled={onchainRunning}
              onClick={() => void runOnChain()}
            >
              <Radio className="size-4" />
              {onchainRunning ? "Settling on-chain…" : "Settle this scenario on-chain"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!onchain ? (
            <p className="text-sm text-muted-foreground">
              Selected: <span className="font-medium">{PREDICATE_ATTACK_LABELS[selected]}</span>. Click to
              settle it through the on-chain guard and see the real tx.
            </p>
          ) : onchain.available === false ? (
            <p className="text-sm text-muted-foreground">
              {onchain.note ?? "On-chain guard not configured in this environment."}
            </p>
          ) : onchain.error ? (
            <p className="text-sm text-destructive">{onchain.error}</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {onchain.attackId ? PREDICATE_ATTACK_LABELS[onchain.attackId] : "scenario"}
                </Badge>
                <Badge
                  className={cn(
                    onchain.reverted
                      ? "bg-emerald-600 hover:bg-emerald-600"
                      : "bg-sky-600 hover:bg-sky-600",
                  )}
                >
                  {onchain.reverted ? "REVERTED on-chain" : "Allowed on-chain"}
                </Badge>
                {onchain.reason ? <Badge variant="outline">{onchain.reason}</Badge> : null}
              </div>
              {onchain.detail ? <p className="text-muted-foreground">{onchain.detail}</p> : null}
              <p className="text-muted-foreground">{onchain.note}</p>
              {onchain.url ? (
                <a
                  href={onchain.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-xs text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
                >
                  {onchain.txHash?.slice(0, 18)}… — view the {onchain.reverted ? "rejected" : "settled"} tx
                  on BaseScan
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div id="predicate-attack-anatomy" className="scroll-mt-6">
        <PredicateAnatomyPanel
          anatomy={result?.anatomy ?? null}
          preventionLayer={result?.preventionLayer}
        />
      </div>

      <BaselineMatrixSection
        title="Predicate soundness (P5) baseline matrix"
        description="Rows update as you run scenarios. Each baseline cell is computed by actually running that weaker verifier; only the full stack (B3) prevents violations at settlement."
        rows={matrixRows}
        matrix={matrix}
      />

      {research ? (
        <p className="rounded-lg border border-border/70 bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
          This is a separate matrix from the human-present binding attacks on purpose. The delegated
          flow tests predicate soundness (P5) — that the agent cannot settle outside the rules the
          human signed — rather than re-running the same binding attacks under R17, which would add
          no new evidence.
        </p>
      ) : null}

      <DemoSection title="Metrics">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Verify latency</CardDescription>
              <CardTitle>
                {result ? `${result.metrics.verifyLatencyMs.toFixed(2)} ms` : "Pending"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Evidence events</CardDescription>
              <CardTitle>{result?.metrics.eventCount ?? "Pending"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Storage estimate</CardDescription>
              <CardTitle>
                {result ? `${(result.metrics.storageBytesEstimate / 1024).toFixed(2)} KB` : "Pending"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </DemoSection>

      {research ? (
        <DemoSection title="Protocol detail">
          <ProtocolPanel
            label="PredicateAttackRunResult"
            data={(result ?? { status }) as unknown as Record<string, unknown>}
          />
        </DemoSection>
      ) : null}
    </div>
  );
}
