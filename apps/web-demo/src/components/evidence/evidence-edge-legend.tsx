"use client";

import type { EvidenceEdge } from "@clb-acel/schemas";
import { EDGE_THEME } from "@/lib/evidence-graph-theme";

export function EvidenceEdgeLegend({ edgeTypes }: { edgeTypes: EvidenceEdge[] }) {
  const unique = [...new Set(edgeTypes)].sort((left, right) => left.localeCompare(right));

  return (
    <div className="flex flex-wrap gap-3 rounded-lg border border-dashed border-border bg-muted/20 p-3">
      <p className="w-full text-xs font-medium text-muted-foreground">Edge legend</p>
      {unique.map((edgeType) => {
        const theme = EDGE_THEME[edgeType];
        return (
          <div key={edgeType} className="flex min-w-[140px] items-start gap-2">
            <span
              className="mt-1 inline-block h-0.5 w-6 shrink-0"
              style={{
                backgroundColor: theme.stroke,
                borderTop: theme.dash ? `2px dashed ${theme.stroke}` : undefined,
                height: theme.dash ? 0 : 2,
              }}
            />
            <div>
              <p className="font-mono text-[10px] font-semibold" style={{ color: theme.stroke }}>
                {theme.label}
              </p>
              <p className="text-[10px] text-muted-foreground">{theme.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
