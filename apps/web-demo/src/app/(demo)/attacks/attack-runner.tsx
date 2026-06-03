"use client";

import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useResearchMode } from "@/components/research-mode-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  BaselineMatrixSection,
  type BaselineMatrixRow,
} from "./components/baseline-matrix-section";
import { PreventionLayerBadge } from "./components/prevention-layer-badge";
import { AttackRunButton } from "./components/attack-run-button";

type AttackId =
  | "PAYEE_SUBSTITUTION"
  | "AMOUNT_ESCALATION"
  | "ASSET_SWITCH"
  | "CHAIN_TRANSPLANT"
  | "AGENT_IDENTITY_SWAP"
  | "MANDATE_REPLAY"
  | "CART_OR_TASK_SWITCH"
  | "PAYMENT_WITHOUT_DELIVERY"
  | "FAKE_FEEDBACK"
  | "PROMPT_INJECTION_SELECTION";

type AttackMeta = {
  id: AttackId;
  description: string;
  expectedResultCode: string;
  expectedFailedRules: string[];
};

type BaselineOutcome = {
  detected: boolean;
  prevented: boolean;
  note: string;
  failedRules?: string[];
};

type BaselineMatrix = Record<AttackId, Record<"B0" | "B1" | "B2" | "B3", BaselineOutcome>>;
type PartialBaselineMatrix = Partial<BaselineMatrix>;

type AttackMutation = {
  path: string;
  before: string;
  after: string;
  impact: string;
};

type AttackAnatomy = {
  summary: string;
  steps: string[];
  mutations: AttackMutation[];
  evidenceFocus: string[];
  detectedBy: string[];
  honestTrace: {
    settlement: {
      payTo: string;
      value: string;
      asset: string;
      chainId: number;
      nonce: string;
    };
    mandate: {
      maxAmount?: string;
      allowedAssets?: string[];
      allowedPayees?: string[];
      taskHash?: string;
    };
    payerAgent: {
      authorizedPaymentKeys: string[];
    };
    report: {
      inputDataHash: string;
      reportHash: string;
    };
    evidence: {
      eventCount: number;
      objectTypes: string[];
      feedbackEventIds: string[];
      selectedPayee?: string;
    };
    nonceReplayAttempt: boolean;
  };
  attackedTrace: {
    settlement: {
      payTo: string;
      value: string;
      asset: string;
      chainId: number;
      nonce: string;
    };
    mandate: {
      maxAmount?: string;
      allowedAssets?: string[];
      allowedPayees?: string[];
      taskHash?: string;
    };
    payerAgent: {
      authorizedPaymentKeys: string[];
    };
    report: {
      inputDataHash: string;
      reportHash: string;
    };
    evidence: {
      eventCount: number;
      objectTypes: string[];
      feedbackEventIds: string[];
      selectedPayee?: string;
    };
    nonceReplayAttempt: boolean;
  };
};

type AttackRunResult = {
  attackId: AttackId;
  traceId: string;
  scenario?: {
    seed: number;
    token: string;
    baseAmount: string;
    attackAmount: string;
    allowedAsset: string;
    attackAsset: string;
    attackerPayee: string;
    taskHash: string;
    reportInputDataHash: string;
  };
  expectedResultCode: string;
  expectedFailedRules: string[];
  matched: boolean;
  preventionLayer: string;
  auditCheck?: { ok: boolean; detail?: string };
  anatomy: AttackAnatomy;
  baselineComparison: Record<"B0" | "B1" | "B2" | "B3", BaselineOutcome>;
  verification: {
    result: {
      status: "PASS" | "FAIL" | "WARNING";
      failedRules: string[];
    };
  };
  metrics: {
    verifyLatencyMs: number;
    settlementLatencyMs?: number;
    eventCount: number;
    storageBytesEstimate: number;
  };
};

const fallbackAttacks: AttackMeta[] = [
  {
    id: "PAYEE_SUBSTITUTION",
    description: "Settlement payee is swapped to an attacker address.",
    expectedResultCode: "PAYEE_MISMATCH",
    expectedFailedRules: ["R12_PAYEE_MATCHES_CHECKOUT_OR_TASK"],
  },
  {
    id: "AMOUNT_ESCALATION",
    description: "Settlement amount exceeds the human mandate max amount.",
    expectedResultCode: "AMOUNT_EXCEEDS_MANDATE",
    expectedFailedRules: ["R11_AMOUNT_WITHIN_MANDATE"],
  },
  {
    id: "ASSET_SWITCH",
    description: "Settlement asset changes from allowed USDC.",
    expectedResultCode: "ASSET_NOT_ALLOWED",
    expectedFailedRules: ["R13_ASSET_ALLOWED"],
  },
  {
    id: "CHAIN_TRANSPLANT",
    description: "Settlement receipt is transplanted to the wrong chain.",
    expectedResultCode: "CHAIN_DOMAIN_MISMATCH",
    expectedFailedRules: ["R10_CHAIN_DOMAIN_MATCHES"],
  },
  {
    id: "AGENT_IDENTITY_SWAP",
    description: "Payer key is not authorized by the bound agent card.",
    expectedResultCode: "UNAUTHORIZED_PAYMENT_KEY",
    expectedFailedRules: ["R4_AGENT_PAYMENT_KEY_AUTHORIZED"],
  },
  {
    id: "MANDATE_REPLAY",
    description: "The same CLB-derived x402 nonce is submitted twice.",
    expectedResultCode: "NONCE_REPLAY",
    expectedFailedRules: ["R9_NONCE_CONSUMED_EXACTLY_ONCE"],
  },
  {
    id: "CART_OR_TASK_SWITCH",
    description: "Mandate taskHash and delivered report input hash diverge.",
    expectedResultCode: "TASK_HASH_MISMATCH",
    expectedFailedRules: ["R15_TASK_HASH_MATCHES"],
  },
  {
    id: "PAYMENT_WITHOUT_DELIVERY",
    description: "Delivery proof is invalid after payment settlement.",
    expectedResultCode: "DELIVERY_MISSING_OR_INVALID",
    expectedFailedRules: ["R2_SIGNATURES_VALID"],
  },
  {
    id: "FAKE_FEEDBACK",
    description: "Feedback appears without a verifier certificate predecessor.",
    expectedResultCode: "FAKE_FEEDBACK_WITHOUT_VERIFICATION",
    expectedFailedRules: [],
  },
  {
    id: "PROMPT_INJECTION_SELECTION",
    description: "Discovery selects a merchant outside allowedPayees.",
    expectedResultCode: "PROMPT_INJECTION_SELECTED_UNAUTHORIZED_MERCHANT",
    expectedFailedRules: [],
  },
];

/** Split SCREAMING_SNAKE ids into readable card labels. */
function attackLabel(id: string): string {
  return id
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function stringifyTraceValue(value: unknown): string {
  if (value === undefined) {
    return "not present";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : value.join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function flattenTrace(
  value: unknown,
  prefix = "",
  rows: Array<{ path: string; value: string }> = [],
) {
  if (Array.isArray(value)) {
    rows.push({ path: prefix, value: stringifyTraceValue(value) });
    return rows;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      flattenTrace(child, prefix ? `${prefix}.${key}` : key, rows);
    }
    return rows;
  }

  rows.push({ path: prefix, value: stringifyTraceValue(value) });
  return rows;
}

function traceDiffRows(anatomy: AttackAnatomy) {
  const honestRows = flattenTrace(anatomy.honestTrace);
  const attackedRows = flattenTrace(anatomy.attackedTrace);
  const honestByPath = new Map(honestRows.map((row) => [row.path, row.value]));
  const attackedByPath = new Map(attackedRows.map((row) => [row.path, row.value]));
  const paths = [...new Set([...honestByPath.keys(), ...attackedByPath.keys()])].sort();

  return paths.map((path) => {
    const before = honestByPath.get(path) ?? "not present";
    const after = attackedByPath.get(path) ?? "not present";
    return { path, before, after, changed: before !== after };
  });
}

function AttackAnatomyPanel({ result }: { result: AttackRunResult | null }) {
  if (!result) {
    return (
      <DemoSection title="Attack anatomy">
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Run an attack to inspect the malicious mutation, the evidence it touched, and the rule or
          audit check that caught it.
        </div>
      </DemoSection>
    );
  }

  const { anatomy } = result;
  const diffRows = traceDiffRows(anatomy);

  return (
    <DemoSection title="Attack anatomy">
      <div className="@container/anatomy space-y-4 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-semibold">Inside {attackLabel(result.attackId)}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{anatomy.summary}</p>
        </div>

        {/* {scenario ? (
          <div className="grid gap-2 text-sm @2xl/anatomy:grid-cols-5">
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Token</p>
              <p className="mt-1 font-mono">{scenario.token}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Amount</p>
              <p className="mt-1 font-mono">
                {scenario.baseAmount} {"->"} {scenario.attackAmount}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Asset</p>
              <p className="mt-1 font-mono">
                {scenario.allowedAsset} {"->"} {scenario.attackAsset}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Attacker</p>
              <p className="mt-1 truncate font-mono" title={scenario.attackerPayee}>
                {scenario.attackerPayee}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Seed</p>
              <p className="mt-1 font-mono">{scenario.seed}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
            Scenario variables are unavailable in this response. Restart the attack-simulator service to load the latest runner.
          </div>
        )} */}

        <div className="grid gap-4 @3xl/anatomy:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-lg border border-border/70">
            <div className="border-b border-border/70 px-3 py-2">
              <p className="text-sm font-semibold">What changed</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[10rem]">Path</TableHead>
                    <TableHead className="min-w-[11rem]">Before</TableHead>
                    <TableHead className="min-w-[11rem]">After</TableHead>
                    <TableHead className="min-w-[14rem]">Impact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anatomy.mutations.map((mutation) => (
                    <TableRow key={mutation.path}>
                      <TableCell className="font-mono text-xs">{mutation.path}</TableCell>
                      <TableCell className="max-w-[14rem] whitespace-normal break-all text-sm text-muted-foreground">
                        {mutation.before}
                      </TableCell>
                      <TableCell className="max-w-[14rem] whitespace-normal break-all text-sm">
                        {mutation.after}
                      </TableCell>
                      <TableCell className="max-w-[18rem] whitespace-normal break-words text-sm text-muted-foreground">
                        {mutation.impact}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-sm font-semibold">How it entered</p>
              <ol className="mt-3 space-y-2">
                {anatomy.steps.map((step, index) => (
                  <li key={`${index}-${step}`} className="flex gap-2 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-border/70 p-3">
              <p className="text-sm font-semibold">Why it was caught</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {anatomy.detectedBy.map((detector) => (
                  <Badge
                    key={detector}
                    variant="secondary"
                    className="max-w-full whitespace-normal break-all text-left"
                  >
                    {detector}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs font-semibold uppercase text-muted-foreground">
                Evidence focus
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {anatomy.evidenceFocus.map((event) => (
                  <Badge
                    key={event}
                    variant="outline"
                    className="max-w-full whitespace-normal break-all text-left"
                  >
                    {event}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/70">
          <div className="flex flex-col gap-1 border-b border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold">Honest vs attacked trace</p>
            <Badge variant="secondary" className="w-fit">
              {diffRows.filter((row) => row.changed).length} changed
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[13rem]">Trace path</TableHead>
                  <TableHead className="min-w-[16rem]">Honest</TableHead>
                  <TableHead className="min-w-[16rem]">Attacked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffRows.map((row) => (
                  <TableRow
                    key={row.path}
                    className={cn(row.changed && "bg-amber-100/70 hover:bg-amber-100 dark:bg-amber-950/30")}
                  >
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <span className="break-all">{row.path}</span>
                        {row.changed ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                            changed
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[20rem] whitespace-normal break-all font-mono text-xs text-muted-foreground">
                      {row.before}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "max-w-[20rem] whitespace-normal break-all font-mono text-xs",
                        row.changed ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {row.after}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}

export function AttackRunner({ serviceUrl }: { serviceUrl: string }) {
  const { enabled: research } = useResearchMode();
  const [attacks, setAttacks] = useState<AttackMeta[]>(fallbackAttacks);
  const [selected, setSelected] = useState<AttackId>("PAYEE_SUBSTITUTION");
  const [matrix, setMatrix] = useState<PartialBaselineMatrix | null>(null);
  const [result, setResult] = useState<AttackRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Loading simulator metadata...");

  const selectedMeta = useMemo(
    () => attacks.find((attack) => attack.id === selected) ?? fallbackAttacks[0],
    [attacks, selected],
  );

  const matrixRows: BaselineMatrixRow[] = useMemo(
    () =>
      attacks.map((attack) => ({
        id: attack.id,
        label: attackLabel(attack.id),
        highlight: result?.attackId === attack.id || (!result && selected === attack.id),
      })),
    [attacks, result, selected],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const attacksResponse = await fetch(`${serviceUrl}/attacks`);
        if (!attacksResponse.ok) {
          throw new Error("Simulator service unavailable");
        }
        const attacksPayload = (await attacksResponse.json()) as { attacks: AttackMeta[] };
        if (!cancelled) {
          setAttacks(attacksPayload.attacks);
          setStatus("Connected to attack-simulator :4006");
        }
      } catch {
        if (!cancelled) {
          setStatus("Using fixture metadata fallback; start attack-simulator for live runs.");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [serviceUrl]);

  async function runSelectedAttack() {
    setLoading(true);
    setStatus(`Running ${selected}...`);
    try {
      const response = await fetch(`${serviceUrl}/attacks/${selected}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nowMs: Date.now() }),
      });
      if (!response.ok) {
        throw new Error(`Run failed with ${response.status}`);
      }
      const payload = (await response.json()) as AttackRunResult;
      setResult(payload);
      setMatrix((current) => ({
        ...(current ?? {}),
        [payload.attackId]: payload.baselineComparison,
      }));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const anatomySection = document.getElementById("attack-anatomy");
          if (!anatomySection) {
            return;
          }
          history.replaceState(null, "", "#attack-anatomy");
          anatomySection.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
      setStatus(
        payload.matched ? "Attack detected as expected" : "Attack result did not match expectation",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Attack run failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Attack runner</CardTitle>
              <CardDescription>{status}</CardDescription>
            </div>
            <AttackRunButton loading={loading} onClick={runSelectedAttack} label="Run attack" />
          </div>
        </CardHeader>
        <CardContent className="@container/card space-y-5">
          {/* Container-query grid: viewport lg ≠ content width when the demo sidebar is open. */}
          <div className="grid grid-cols-1 gap-2 @sm/card:grid-cols-2 @2xl/card:grid-cols-3">
            {attacks.map((attack) => (
              <button
                key={attack.id}
                type="button"
                onClick={() => setSelected(attack.id)}
                className={cn(
                  "flex min-h-[4.5rem] min-w-0 w-full flex-col gap-1 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected === attack.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <span className="line-clamp-2 text-sm font-semibold leading-snug">
                  {attackLabel(attack.id)}
                </span>
                <span
                  className="line-clamp-2 break-all text-xs leading-snug text-muted-foreground"
                  title={attack.expectedResultCode}
                >
                  {attack.expectedResultCode}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 @2xl/card:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
            <div className="min-w-0 rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold leading-snug">
                    {attackLabel(selectedMeta.id)}
                  </p>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    {selectedMeta.id}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {selectedMeta.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="max-w-full whitespace-normal break-all text-left"
                    >
                      {selectedMeta.expectedResultCode}
                    </Badge>
                    {selectedMeta.expectedFailedRules.length > 0 ? (
                      selectedMeta.expectedFailedRules.map((rule) => (
                        <Badge
                          key={rule}
                          variant="secondary"
                          className="max-w-full whitespace-normal break-all text-left"
                        >
                          {rule}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="secondary">Audit-layer check</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-border p-4">
              <p className="text-sm font-semibold">Latest result</p>
              {result ? (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    {result.matched ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    )}
                    <span className="font-medium">{result.matched ? "Matched" : "Mismatch"}</span>
                  </div>
                  <PreventionLayerBadge layer={result.preventionLayer} />
                  <p className="break-words text-muted-foreground">
                    Failed: {result.verification.result.failedRules.join(", ") || "audit check"}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No attack run yet.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div id="attack-anatomy" className="scroll-mt-6">
        <AttackAnatomyPanel result={result} />
      </div>

      <BaselineMatrixSection
        title="Baseline matrix"
        description="Rows update as attacks are run. The highlighted row is the latest live B3 comparison."
        rows={matrixRows}
        matrix={matrix ?? null}
      />

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
                {result
                  ? `${(result.metrics.storageBytesEstimate / 1024).toFixed(2)} KB`
                  : "Pending"}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      </DemoSection>

      {research ? (
        <DemoSection title="Protocol detail">
          <ProtocolPanel
            label="AttackRunResult"
            data={(result ?? { status }) as unknown as Record<string, unknown>}
          />
        </DemoSection>
      ) : null}
    </div>
  );
}
