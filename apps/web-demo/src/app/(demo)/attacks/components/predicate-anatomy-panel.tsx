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
import { cn } from "@/lib/utils";
import { PreventionLayerBadge } from "./prevention-layer-badge";

export type PredicateTraceSummary = {
  mandateType: "INTENT";
  predicate: {
    allowedPayees: string[];
    maxValue: string;
    allowedAssets: string[];
    validUntil: string;
    allowedChainIds: number[];
  };
  concreteSettlement: {
    payTo: string;
    value: string;
    asset: string;
    chainId: number;
    validBefore: string;
  };
  settledAt: string;
  commitmentCprime: string;
  nonce: string;
  guardWouldAllow: boolean;
};

export type PredicateAttackAnatomy = {
  summary: string;
  steps: string[];
  mutations: Array<{ path: string; before: string; after: string; impact: string }>;
  evidenceFocus: string[];
  detectedBy: string[];
  authorizedTrace: PredicateTraceSummary;
  violatedTrace: PredicateTraceSummary;
};

type DiffRow = { label: string; authorized: string; violated: string; changed: boolean };

function buildDiffRows(authorized: PredicateTraceSummary, violated: PredicateTraceSummary): DiffRow[] {
  const rows: Array<{ label: string; a: string; v: string }> = [
    {
      label: "Allowed merchants (π)",
      a: authorized.predicate.allowedPayees.join(", "),
      v: violated.predicate.allowedPayees.join(", "),
    },
    { label: "Spending cap (π)", a: authorized.predicate.maxValue, v: violated.predicate.maxValue },
    {
      label: "Allowed tokens (π)",
      a: authorized.predicate.allowedAssets.join(", "),
      v: violated.predicate.allowedAssets.join(", "),
    },
    { label: "Deadline (π)", a: authorized.predicate.validUntil, v: violated.predicate.validUntil },
    {
      label: "Settled payee",
      a: authorized.concreteSettlement.payTo,
      v: violated.concreteSettlement.payTo,
    },
    {
      label: "Settled amount",
      a: authorized.concreteSettlement.value,
      v: violated.concreteSettlement.value,
    },
    {
      label: "Settled token",
      a: authorized.concreteSettlement.asset,
      v: violated.concreteSettlement.asset,
    },
    { label: "Settled at", a: authorized.settledAt, v: violated.settledAt },
  ];

  return rows.map((row) => ({
    label: row.label,
    authorized: row.a,
    violated: row.v,
    changed: row.a !== row.v,
  }));
}

function SignedRules({ trace }: { trace: PredicateTraceSummary }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-sm font-semibold">What you signed (spending rules)</p>
      <dl className="mt-3 space-y-2 text-sm">
        <Row label="Allowed merchants" value={trace.predicate.allowedPayees.join(", ")} mono />
        <Row label="Spending cap" value={trace.predicate.maxValue} />
        <Row label="Allowed tokens" value={trace.predicate.allowedAssets.join(", ")} />
        <Row label="Deadline" value={trace.predicate.validUntil} />
      </dl>
    </div>
  );
}

function AgentAttempt({ trace }: { trace: PredicateTraceSummary }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-sm font-semibold">What the agent tried to settle</p>
      <dl className="mt-3 space-y-2 text-sm">
        <Row label="Payee" value={trace.concreteSettlement.payTo} mono />
        <Row label="Amount" value={trace.concreteSettlement.value} />
        <Row label="Token" value={trace.concreteSettlement.asset} />
        <Row label="Settled at" value={trace.settledAt} />
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-all", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}

export function PredicateAnatomyPanel({
  anatomy,
  preventionLayer,
}: {
  anatomy: PredicateAttackAnatomy | null;
  preventionLayer?: string;
}) {
  if (!anatomy) {
    return (
      <DemoSection title="Attack anatomy">
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Run a scenario to see what you signed, what the agent tried, and how the binding stack
          responded.
        </div>
      </DemoSection>
    );
  }

  const diffRows = buildDiffRows(anatomy.authorizedTrace, anatomy.violatedTrace);
  const changedCount = diffRows.filter((row) => row.changed).length;

  return (
    <DemoSection title="Attack anatomy">
      <div className="@container/anatomy space-y-4 rounded-lg border border-border p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">{anatomy.summary}</p>

        <div className="grid gap-4 @2xl/anatomy:grid-cols-2">
          <SignedRules trace={anatomy.violatedTrace} />
          <AgentAttempt trace={anatomy.violatedTrace} />
        </div>

        {anatomy.mutations.length > 0 ? (
          <div className="rounded-lg border border-border/70">
            <div className="border-b border-border/70 px-3 py-2">
              <p className="text-sm font-semibold">What changed</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[9rem]">Field</TableHead>
                    <TableHead className="min-w-[10rem]">Within rules</TableHead>
                    <TableHead className="min-w-[10rem]">Attempted</TableHead>
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
        ) : (
          <div className="rounded-lg border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            The agent stayed inside every signed rule, so there is nothing to block. This is the
            allowed happy path.
          </div>
        )}

        <div className="grid gap-4 @3xl/anatomy:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-border/70 p-3">
            <p className="text-sm font-semibold">How it played out</p>
            <ol className="mt-3 space-y-2">
              {anatomy.steps.map((step, index) => (
                <li key={step} className="flex gap-2 text-sm">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 leading-relaxed text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border border-border/70 p-3">
            <p className="text-sm font-semibold">How it was stopped</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {preventionLayer ? <PreventionLayerBadge layer={preventionLayer} /> : null}
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

        <div className="rounded-lg border border-border/70">
          <div className="flex flex-col gap-1 border-b border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold">Within rules vs attempted settlement</p>
            <Badge variant="secondary" className="w-fit">
              {changedCount} changed
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[12rem]">Field</TableHead>
                  <TableHead className="min-w-[14rem]">Within rules</TableHead>
                  <TableHead className="min-w-[14rem]">Attempted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffRows.map((row) => (
                  <TableRow
                    key={row.label}
                    className={cn(
                      row.changed && "bg-amber-100/70 hover:bg-amber-100 dark:bg-amber-950/30",
                    )}
                  >
                    <TableCell className="text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <span className="break-words">{row.label}</span>
                        {row.changed ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500 text-amber-700 dark:text-amber-300"
                          >
                            changed
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[18rem] whitespace-normal break-all font-mono text-xs text-muted-foreground">
                      {row.authorized}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "max-w-[18rem] whitespace-normal break-all font-mono text-xs",
                        row.changed ? "font-semibold text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {row.violated}
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
