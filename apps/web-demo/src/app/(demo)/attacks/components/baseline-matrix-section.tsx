import { BASELINE_LABELS } from "@clb-acel/attack-core";
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
import { BASELINE_EXPLAINER } from "@/lib/demo-copy";
import { cn } from "@/lib/utils";

export const BASELINE_IDS = ["B0", "B1", "B2", "B3"] as const;
export type BaselineId = (typeof BASELINE_IDS)[number];

export type BaselineOutcome = {
  detected: boolean;
  prevented: boolean;
  note?: string;
  failedRules?: string[];
};

export function outcomeBadge(outcome?: BaselineOutcome) {
  if (!outcome) {
    return <Badge variant="outline">Pending</Badge>;
  }
  if (outcome.prevented) {
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Prevented</Badge>;
  }
  if (outcome.detected) {
    return <Badge variant="secondary">Detected</Badge>;
  }
  return <Badge variant="destructive">Allowed</Badge>;
}

export type BaselineMatrixRow = {
  id: string;
  label: string;
  highlight?: boolean;
};

/**
 * Shared B0–B3 baseline matrix used by both attack runners so the two tabs
 * stay visually and semantically in sync.
 */
export function BaselineMatrixSection({
  title,
  description,
  rows,
  matrix,
  showExplainer = true,
}: {
  title: string;
  description: string;
  rows: BaselineMatrixRow[];
  matrix: Partial<Record<string, Partial<Record<BaselineId, BaselineOutcome>>>> | null;
  showExplainer?: boolean;
}) {
  return (
    <DemoSection title={title}>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      {showExplainer ? (
        <dl className="grid gap-2 rounded-lg border border-border/70 p-3 text-sm sm:grid-cols-2">
          {BASELINE_IDS.map((id) => (
            <div key={id} className="flex gap-2">
              <dt className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">{id}</dt>
              <dd className="text-muted-foreground">{BASELINE_EXPLAINER[id]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-48 border-b border-border bg-muted/40 px-3">
                  Attack
                </TableHead>
                {BASELINE_IDS.map((id) => (
                  <TableHead key={id} className="min-w-32 border-b border-border bg-muted/40 px-3">
                    <div className="space-y-0.5">
                      <div>{BASELINE_LABELS[id]}</div>
                      <div className="text-xs font-normal text-muted-foreground">{id}</div>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    row.highlight && "bg-primary/10 hover:bg-primary/10",
                  )}
                >
                  <TableCell className="max-w-56 border-r border-border px-3 font-medium">
                    <span className="line-clamp-2 break-words leading-snug">{row.label}</span>
                  </TableCell>
                  {BASELINE_IDS.map((id) => (
                    <TableCell key={id} className="px-3">
                      {outcomeBadge(matrix?.[row.id]?.[id])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DemoSection>
  );
}
