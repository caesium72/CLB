"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { EvidenceEdgeData } from "@/lib/evidence-graph-layout";
import { EDGE_THEME } from "@/lib/evidence-graph-theme";

export function SemanticEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const edgeData = data as EvidenceEdgeData | undefined;
  const edgeType = edgeData?.edgeType ?? "AUTHORIZES";
  const theme = EDGE_THEME[edgeType];

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY: sourceY + 18,
    targetX,
    targetY: targetY + 18,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: theme.stroke,
          strokeWidth: 2.5,
        }}
        markerEnd={`url(#arrow-${edgeType})`}
      />
      <EdgeLabelRenderer>
        <div
          className="z-10 pointer-events-none absolute rounded border bg-background/95 px-1.5 py-0.5 font-mono text-[9px] font-medium shadow-sm"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 14}px)`,
            color: theme.stroke,
            borderColor: theme.stroke,
          }}
        >
          {edgeData?.label ?? theme.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
