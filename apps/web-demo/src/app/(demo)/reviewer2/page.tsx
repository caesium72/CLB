import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DemoSection } from "@/components/demo-shell";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DownloadCsvButton } from "./download-csv";

/**
 * Static readout of the Reviewer #2 / Comment 1 evaluation artifacts.
 * No live code execution: the numbers come from files produced by
 * `bun run e2e:reviewer2:comment1`.
 */
type Bucket = { total: number; detected: number };

type MatrixArtifact = {
  generatedAt: string;
  seeds: number[];
  summary: {
    scenarioCount: number;
    detectedCount: number;
    detectionRate: number;
    undetected: string[];
    byDepth: Record<"1" | "2" | "3", Bucket>;
    byFamily: Record<string, Bucket>;
  };
};

type PreSettlementArtifact = {
  generatedAt: string;
  results: Array<{
    id: string;
    addresses: string[];
    guardAllowed: boolean;
    settlementAttempted: boolean;
    receiptIssued: boolean;
    prevented: boolean;
    predicateViolations: string[];
  }>;
};

type ConcurrencyArtifact = {
  generatedAt: string;
  levels: number[];
  summary: {
    trialCount: number;
    totalAttempts: number;
    totalSettled: number;
    totalRejected: number;
    anomalyCount: number;
  };
  results: Array<{
    level: number;
    mode: string;
    attempted: number;
    settled: number;
    expectedSettled: number;
    ok: boolean;
  }>;
};

type ComposedArtifact = {
  generatedAt: string;
  results: Array<{
    id: string;
    detected: boolean;
    detectionStage: string;
    failedRules: string[];
  }>;
};

const DEPTH_LABELS: Record<"1" | "2" | "3", string> = {
  "1": "single primitive",
  "2": "ordered pair",
  "3": "three-step chain",
};

function artifactDir(): string {
  return resolve(
    process.env.REVIEWER2_ARTIFACT_DIR ?? resolve(process.cwd(), "..", "..", "experiments", "benchmarks", "reviewer2", "comment1"),
  );
}

async function loadArtifact<T>(fileName: string): Promise<T> {
  const raw = await readFile(resolve(artifactDir(), fileName), "utf8");
  return JSON.parse(raw) as T;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function rate(bucket: Bucket): string {
  return `${((bucket.detected / bucket.total) * 100).toFixed(0)}%`;
}

export default async function Reviewer2Page() {
  let matrix: MatrixArtifact;
  let presettlement: PreSettlementArtifact;
  let concurrency: ConcurrencyArtifact;
  let composed: ComposedArtifact;

  try {
    [matrix, presettlement, concurrency, composed] = await Promise.all([
      loadArtifact<MatrixArtifact>("adversarial-matrix.json"),
      loadArtifact<PreSettlementArtifact>("presettlement-results.json"),
      loadArtifact<ConcurrencyArtifact>("concurrency-results.json"),
      loadArtifact<ComposedArtifact>("composed-attack-results.json"),
    ]);
  } catch (error) {
    return (
      <DemoSection title="No evaluation artifacts found">
        <p className="text-sm text-muted-foreground">
          Run <code className="font-mono">bun run e2e:reviewer2:comment1</code> from the repository root,
          then refresh this page. Artifacts are read from <code className="font-mono">{artifactDir()}</code>.
        </p>
        <p className="mt-2 font-mono text-xs text-destructive">{String(error)}</p>
      </DemoSection>
    );
  }

  const prevented = presettlement.results.filter((row) => row.prevented).length;
  const noReceipt = presettlement.results.filter((row) => !row.receiptIssued).length;
  const concurrencyRows = concurrency.levels.map((level) => {
    const rows = concurrency.results.filter((row) => row.level === level);
    const settled = (mode: string) =>
      rows.filter((row) => row.mode === mode).reduce((sum, row) => sum + row.settled, 0);
    return {
      level,
      trials: rows.filter((row) => row.mode === "same-nonce").length,
      same: settled("same-nonce"),
      distinct: settled("distinct-nonce"),
      mixed: settled("mixed"),
      anomalies: rows.filter((row) => !row.ok).length,
    };
  });

  const csv = {
    depth: (["1", "2", "3"] as const).map((depth) => [
      DEPTH_LABELS[depth],
      matrix.summary.byDepth[depth].total,
      matrix.summary.byDepth[depth].detected,
    ]),
    family: Object.entries(matrix.summary.byFamily).map(([family, bucket]) => [
      family,
      bucket.total,
      bucket.detected,
    ]),
    prevention: presettlement.results.map((row) => [
      row.id,
      row.guardAllowed,
      row.settlementAttempted,
      row.receiptIssued,
      row.prevented,
    ]),
    concurrency: concurrencyRows.map((row) => [
      row.level,
      row.trials,
      row.same,
      row.distinct,
      row.anomalies,
    ]),
  };

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Adversarial scenarios"
          value={String(matrix.summary.scenarioCount)}
          detail={`${matrix.seeds.length} seeds · ${matrix.summary.detectedCount} detected`}
        />
        <StatCard
          label="Detection rate"
          value={`${(matrix.summary.detectionRate * 100).toFixed(0)}%`}
          detail={`${matrix.summary.undetected.length} undetected`}
        />
        <StatCard
          label="Pre-settlement"
          value={`${prevented}/${presettlement.results.length}`}
          detail={`${noReceipt} with no receipt issued`}
        />
        <StatCard
          label="Concurrent attempts"
          value={concurrency.summary.totalAttempts.toLocaleString()}
          detail={`${concurrency.summary.anomalyCount} anomalies`}
        />
      </div>

      <DemoSection title="Compositional attack matrix">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nine attack primitives are executed alone, in every ordered pair, and in curated three-step
          chains under {matrix.seeds.length} different seeds. Every scenario is checked against the
          deterministic verifier.
        </p>
        <div className="flex flex-wrap gap-2">
          <DownloadCsvButton filename="matrix-by-depth.csv" rows={csv.depth} />
          <DownloadCsvButton filename="matrix-by-family.csv" rows={csv.family} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-b border-border bg-muted/40">Chain depth</TableHead>
                  <TableHead className="border-b border-border bg-muted/40">Scenarios</TableHead>
                  <TableHead className="border-b border-border bg-muted/40">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["1", "2", "3"] as const).map((depth) => (
                  <TableRow key={depth}>
                    <TableCell>{DEPTH_LABELS[depth]}</TableCell>
                    <TableCell className="tabular-nums">{matrix.summary.byDepth[depth].total}</TableCell>
                    <TableCell className="tabular-nums">
                      {matrix.summary.byDepth[depth].detected} ({rate(matrix.summary.byDepth[depth])})
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-b border-border bg-muted/40">Attack family</TableHead>
                  <TableHead className="border-b border-border bg-muted/40">Scenarios</TableHead>
                  <TableHead className="border-b border-border bg-muted/40">Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(matrix.summary.byFamily).map(([family, bucket]) => (
                  <TableRow key={family}>
                    <TableCell className="capitalize">{family}</TableCell>
                    <TableCell className="tabular-nums">{bucket.total}</TableCell>
                    <TableCell className="tabular-nums">
                      {bucket.detected} ({rate(bucket)})
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DemoSection>

      <DemoSection title="Pre-settlement prevention">
        <p className="text-sm leading-relaxed text-muted-foreground">
          The predicate guard is asked before settlement. A false receipt column means no value moved
          for that attacked attempt.
        </p>
        <div className="flex flex-wrap gap-2">
          <DownloadCsvButton filename="presettlement.csv" rows={csv.prevention} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-b border-border bg-muted/40">Scenario</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Guard</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Receipt issued</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {presettlement.results.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id}</TableCell>
                  <TableCell>{row.guardAllowed ? "allowed" : "denied"}</TableCell>
                  <TableCell className="tabular-nums">{String(row.receiptIssued)}</TableCell>
                  <TableCell>
                    {row.prevented ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Prevented</Badge>
                    ) : (
                      <Badge variant="destructive">Failed</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DemoSection>

      <DemoSection title="Concurrent settlement">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Same-nonce bursts may settle exactly once per trial; distinct-nonce bursts must settle
          completely. Mixed bursts combine both shapes.
        </p>
        <div className="flex flex-wrap gap-2">
          <DownloadCsvButton filename="concurrency.csv" rows={csv.concurrency} />
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-b border-border bg-muted/40">Concurrency</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Trials / shape</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Same nonce settled</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Distinct settled</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Anomalies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {concurrencyRows.map((row) => (
                <TableRow key={row.level}>
                  <TableCell className="tabular-nums">{row.level}</TableCell>
                  <TableCell className="tabular-nums">{row.trials}</TableCell>
                  <TableCell className="tabular-nums">{row.same}</TableCell>
                  <TableCell className="tabular-nums">{row.distinct}</TableCell>
                  <TableCell className="tabular-nums">{row.anomalies}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Limitation: the nonce reservation is in-process; a multi-replica facilitator needs a shared
          nonce store.
        </p>
      </DemoSection>

      <DemoSection title="Named multi-step sequences">
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-b border-border bg-muted/40">Sequence</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Stage</TableHead>
                <TableHead className="border-b border-border bg-muted/40">Failed rules</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {composed.results.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id}</TableCell>
                  <TableCell>{row.detectionStage}</TableCell>
                  <TableCell className="font-mono text-xs">{row.failedRules.join(", ") || "audit"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DemoSection>

      <p className="text-xs text-muted-foreground">
        Generated {matrix.generatedAt} · Source: <code className="font-mono">{artifactDir()}</code>
      </p>
    </div>
  );
}
