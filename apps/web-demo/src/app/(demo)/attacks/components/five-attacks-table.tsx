import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Status = "eliminated" | "mitigated" | "partial" | "out-of-scope";

type Row = {
  id: string;
  name: string;
  status: Status;
  result: string;
  defense: string;
  /** Whether we reproduce it live in this lab or only cite the paper's result. */
  provenance: "live" | "cited";
};

/**
 * Honest mapping of the five published x402 attacks (arXiv:2605.11781) onto the
 * CLB-ACEL stack. Mirrors experiments/five-attacks-repro/README.md — we do not
 * overstate: only Attack II is fully eliminated (and reproduced live in the lab).
 */
const FIVE_ATTACKS: Row[] = [
  {
    id: "I-A / I-B",
    name: "Revert-grant / settlement preemption",
    status: "partial",
    result: "Partially mitigated — an optimistic-grant timing window remains.",
    defense: "x402 settlement ordering",
    provenance: "cited",
  },
  {
    id: "II",
    name: "Replay / missing idempotency",
    status: "eliminated",
    result: "Eliminated — reproduced live in this lab and blocked on the second settlement.",
    defense: "R9 — nonce consumed exactly once",
    provenance: "live",
  },
  {
    id: "III",
    name: "Proxy / cache-header manipulation",
    status: "out-of-scope",
    result: "Out of scope — a web-layer issue; we cite their Cache-Control fix.",
    defense: "—",
    provenance: "cited",
  },
  {
    id: "IV",
    name: "Server-selection manipulation",
    status: "mitigated",
    result: "Mitigated when discovery is bound — the selection is recorded as evidence.",
    defense: "Decision-layer instrumentation (DECISION_CONTEXT)",
    provenance: "cited",
  },
];

const STATUS_STYLE: Record<Status, { label: string; className: string }> = {
  eliminated: { label: "Eliminated", className: "bg-emerald-600 hover:bg-emerald-600 text-white" },
  mitigated: { label: "Mitigated", className: "bg-sky-600 hover:bg-sky-600 text-white" },
  partial: { label: "Partial", className: "bg-amber-500 hover:bg-amber-500 text-white" },
  "out-of-scope": { label: "Out of scope", className: "bg-muted text-muted-foreground" },
};

const PROVENANCE_STYLE: Record<Row["provenance"], { label: string; className: string }> = {
  live: { label: "Reproduced live", className: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" },
  cited: { label: "Cited from paper", className: "text-muted-foreground" },
};

export function FiveAttacksTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Five Attacks on x402 — honest mapping</CardTitle>
        <CardDescription>
          How the five published attacks (arXiv:2605.11781) land on the CLB-ACEL stack. We claim only
          what we can show: Attack II is eliminated and reproduced live above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {FIVE_ATTACKS.map((row) => {
            const style = STATUS_STYLE[row.status];
            return (
              <li
                key={row.id}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-4"
              >
                <div className="flex items-center gap-3 sm:flex-col sm:items-start">
                  <span className="font-mono text-sm font-semibold">{row.id}</span>
                  <Badge className={cn("w-fit", style.className)}>{style.label}</Badge>
                  <Badge variant="outline" className={cn("w-fit text-[0.65rem]", PROVENANCE_STYLE[row.provenance].className)}>
                    {PROVENANCE_STYLE[row.provenance].label}
                  </Badge>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{row.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.result}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{row.defense}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
