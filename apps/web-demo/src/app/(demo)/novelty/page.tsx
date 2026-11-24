import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DemoSection } from "@/components/demo-shell";
import { NoveltySimulators } from "@/components/novelty/novelty-simulators";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Read-only novelty evaluation dashboard. All numbers parsed from JSON artifacts. */
const BENCH_DIR = resolve(process.cwd(), "..", "..", "experiments", "novelty");

async function readJSON<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(BENCH_DIR, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

type Strategy = {
  cases: number;
  attackDetected: number;
  attackTotal: number;
  policyGapDetected: number;
  policyGapTotal: number;
  honestRejected: number;
  honestTotal: number;
  falsePositiveRate: number;
  latencyMs: { mean: number; p50: number; p95: number; max: number; n: number };
  extraChecksExecuted: number;
  levelCounts: { V1: number; V2: number; V3: number };
};

type AEARV = {
  generatedAt: string;
  disclaimer: string;
  n: { total: number; honest: number; attack: number; policyGap: number };
  mandatoryRules: string[];
  strategies: { fixedV1: Strategy; adaptive: Strategy; alwaysV3: Strategy };
};

type RCLB = {
  generatedAt: string;
  scope: string;
  commitmentConstruction: { formula: string; acceptance: string };
  scenarios: Array<{
    id: string;
    description: string;
    expectedAccepted: boolean;
    accepted: boolean;
    violations: string[];
    steps: string[];
  }>;
  metrics: {
    scenarioCount: number;
    adversarialCount: number;
    preventedCount: number;
    staleAcceptanceRate: number;
    falseRejectionRate: number;
    raceResistance: number;
    revocationLatencyMs: { samples: number; meanMs: number; medianMs: number; p95Ms: number };
    gasOverhead: { baselineGas: number; rclbGuardGas: number; overheadGas: number };
  };
};

type CDEP = {
  experiment: string;
  deterministic: boolean;
  cases: Array<{
    id: string;
    description: string;
    expectedFindingCodes: string[];
    observedFindingCodes: string[];
    ok: boolean;
    matchedExpectation: boolean;
  }>;
};

type CFRSC = {
  summary: { scenarios: number; passed: number; failed: number };
  propertyDefinitions: Record<string, string>;
  scenarios: Array<{ id: string; injectedFault: string }>;
};

type IRCV = {
  status: string;
  coverage: {
    modelRules: number;
    modelActionLabels: number;
    serializationChecks: number;
    propertyCases: number;
    propertyComparisons: number;
    totalScenarios: number;
    comparableScenarios: number;
  };
  componentResults: {
    differential: string;
    serialization: string;
    propertyTests: string;
    counterexample: string;
  };
  uncovered: string[];
};

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default async function NoveltyPage() {
  const [rclb, aearv, cdep, cfrsc, ircv] = await Promise.all([
    readJSON<RCLB>("rclb/metrics.json"),
    readJSON<AEARV>("aearv/aearv-evaluation.json"),
    readJSON<CDEP>("cdep/results.json"),
    readJSON<CFRSC>("cfrsc/fault-injection-results.json"),
    readJSON<IRCV>("ircv/ircv-summary.json"),
  ]);

  const prevented = rclb?.metrics.preventedCount ?? 0;
  const rclbUnexpected = rclb?.scenarios.filter((s) => !s.expectedAccepted && s.accepted).length ?? 0;
  const cdepDetected = cdep?.cases.filter((c) => !c.ok && c.matchedExpectation).length ?? 0;
  const cdepFalsePos = cdep?.cases.filter((c) => !c.ok && !c.matchedExpectation).length ?? 0;

  return (
    <div className="space-y-8 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold">A³C-VPEAL — Novelty Evaluation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only dashboard. All values are parsed from JSON artifacts under
          <code className="mx-1 font-mono text-xs">experiments/novelty/</code>.
          No live evaluation is triggered by this page.
        </p>
      </div>

      {/* Headline strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="N1 RCLB prevented" value={`${prevented}/${rclb?.scenarios.length ?? "?"}`} detail={`unexpected: ${rclbUnexpected}`} />
        <Stat label="N1 stale acceptance" value={String(rclb?.metrics.staleAcceptanceRate ?? "?")} detail="revoked authority accepted" />
        <Stat label="N3 CDEP attacks" value={`${cdepDetected}/${cdep?.cases.length ?? "?"}`} detail={`false positives: ${cdepFalsePos}`} />
        <Stat label="N4 CFRSC faults" value={`${cfrsc?.summary.passed ?? "?"}/${cfrsc?.summary.scenarios ?? "?"}`} detail="fault-injection passed" />
        <Stat label="N5 adaptive gaps" value={`${aearv?.strategies.adaptive.policyGapDetected ?? "?"}/${aearv?.strategies.adaptive.policyGapTotal ?? "?"}`} detail={`FP ${aearv?.strategies.adaptive.honestRejected ?? "?"}/${aearv?.strategies.adaptive.honestTotal ?? "?"}`} />
        <Stat label="N2 IRCV overall" value={ircv?.status ?? "?"} detail={`${ircv?.coverage.serializationChecks ?? "?"} serialization checks`} />
      </div>

      <DemoSection title="Interactive DEMO Simulations">
        <p className="mb-3 text-sm text-muted-foreground">
          Browser-only state-machine demos — one per novelty. They illustrate the mechanisms; they
          do not execute contracts, call APIs, or alter the measured artifacts above.
        </p>
        <NoveltySimulators />
      </DemoSection>

      <DemoSection title="N1 — Revocation-Aware Temporal Binding (RCLB)">
        <p className="mb-3 font-mono text-xs text-muted-foreground">
          {rclb?.commitmentConstruction.formula ?? "C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N))"}
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Scenario</TableHead>
                <TableHead>Expected accepted</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Violations</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rclb?.scenarios ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.id}</TableCell>
                  <TableCell>{String(s.expectedAccepted)}</TableCell>
                  <TableCell>{String(s.accepted)}</TableCell>
                  <TableCell><span className="font-mono text-xs">{s.violations.join(", ") || "—"}</span></TableCell>
                  <TableCell>
                    {!s.accepted ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700">PREVENTED</Badge>
                    ) : (
                      <Badge variant="destructive">SETTLED</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Revocation latency p95" value={`${rclb?.metrics.revocationLatencyMs.p95Ms.toFixed(4) ?? "?"} ms`} />
          <Stat label="Guard gas" value={rclb?.metrics.gasOverhead.rclbGuardGas.toLocaleString() ?? "?"} />
          <Stat label="Baseline gas" value={rclb?.metrics.gasOverhead.baselineGas.toLocaleString() ?? "?"} />
          <Stat label="Gas overhead" value={rclb?.metrics.gasOverhead.overheadGas.toLocaleString() ?? "?"} />
        </div>
      </DemoSection>

      <DemoSection title="N3 — Causal Delegation & Execution Provenance (CDEP)">
        <p className="mb-3 font-mono text-xs text-muted-foreground">
          C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)
        </p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Case</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Expected findings</TableHead>
                <TableHead>Observed findings</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cdep?.cases ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.id}</TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground">{c.description}</TableCell>
                  <TableCell className="font-mono text-xs">{c.expectedFindingCodes.join(", ") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.observedFindingCodes.join(", ") || "—"}</TableCell>
                  <TableCell>
                    {c.matchedExpectation ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700">AS EXPECTED</Badge>
                    ) : (
                      <Badge variant="destructive">MISMATCH</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DemoSection>

      <DemoSection title="N5 — Adaptive Risk-Based Verification (AEARV)">
        <p className="mb-2 text-xs text-muted-foreground">{aearv?.disclaimer}</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Strategy</TableHead>
                <TableHead>Attacks</TableHead>
                <TableHead>Policy gaps</TableHead>
                <TableHead>Honest FP</TableHead>
                <TableHead>Mean ms</TableHead>
                <TableHead>p95 ms</TableHead>
                <TableHead>Extra checks</TableHead>
                <TableHead>V1 / V2 / V3</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                ["Fixed V1", aearv?.strategies.fixedV1],
                ["Adaptive", aearv?.strategies.adaptive],
                ["Always V3", aearv?.strategies.alwaysV3],
              ] as const).map(([name, s]) => {
                if (!s) return null;
                return (
                  <TableRow key={name}>
                    <TableCell className="font-semibold">{name}</TableCell>
                    <TableCell>{s.attackDetected}/{s.attackTotal}</TableCell>
                    <TableCell>{s.policyGapDetected}/{s.policyGapTotal}</TableCell>
                    <TableCell>{s.honestRejected}/{s.honestTotal}</TableCell>
                    <TableCell className="font-mono tabular-nums">{s.latencyMs.mean.toFixed(3)}</TableCell>
                    <TableCell className="font-mono tabular-nums">{s.latencyMs.p95.toFixed(3)}</TableCell>
                    <TableCell>{s.extraChecksExecuted}</TableCell>
                    <TableCell className="font-mono">{s.levelCounts.V1} / {s.levelCounts.V2} / {s.levelCounts.V3}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Mandatory rules at every tier: {aearv?.mandatoryRules.join(", ")}
        </p>
      </DemoSection>

      <DemoSection title="N4 — Cross-Layer Failure Recovery (CFRSC)">
        <div className="mb-3 font-mono text-xs text-muted-foreground">
          AUTHORIZED → RESERVED → SETTLEMENT_PENDING → SETTLED → FULFILLMENT_PENDING → COMPLETED / DISPUTED / COMPENSATION_PENDING
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>#</TableHead>
                <TableHead>Fault scenario</TableHead>
                <TableHead>Injected fault</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cfrsc?.scenarios ?? []).map((s, i) => (
                <TableRow key={s.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{s.id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.injectedFault}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="Scenarios" value={String(cfrsc?.summary.scenarios ?? "?")} />
          <Stat label="Passed" value={String(cfrsc?.summary.passed ?? "?")} />
          <Stat label="Failed" value={String(cfrsc?.summary.failed ?? "?")} />
        </div>
      </DemoSection>

      <DemoSection title="N2 — Implementation-Refined Compositional Verification (IRCV)">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Differential" value={ircv?.componentResults.differential ?? "?"} />
          <Stat label="Serialization" value={ircv?.componentResults.serialization ?? "?"} />
          <Stat label="Property tests" value={ircv?.componentResults.propertyTests ?? "?"} />
          <Stat label="Counterexample" value={ircv?.componentResults.counterexample ?? "?"} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Model rules" value={String(ircv?.coverage.modelRules ?? "?")} />
          <Stat label="Action labels" value={String(ircv?.coverage.modelActionLabels ?? "?")} />
          <Stat label="PBT comparisons" value={String(ircv?.coverage.propertyComparisons ?? "?")} />
          <Stat label="Scenarios" value={`${ircv?.coverage.comparableScenarios ?? "?"}/${ircv?.coverage.totalScenarios ?? "?"}`} />
        </div>
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold">Uncovered / not proven (honest):</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {(ircv?.uncovered ?? []).map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      </DemoSection>

      <p className="text-xs text-muted-foreground">
        Source: <code className="font-mono">review-revision/novelty/IMPLEMENTATION-STATUS.md</code> ·
        diagrams: <code className="font-mono">review-revision/novelty/&lt;id&gt;/ARCHITECTURE.md</code>
      </p>
    </div>
  );
}
