"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { EvidenceEdgeData } from "@/lib/evidence-graph-layout";
import { EDGE_THEME } from "@/lib/evidence-graph-theme";

export function BindsToEdge({
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
  const theme = EDGE_THEME.BINDS_TO;
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        stroke: theme.stroke,
        strokeWidth: 1.5,
        strokeDasharray: theme.dash,
      }}
      label={edgeData?.label}
      labelBgPadding={[4, 2]}
      labelBgBorderRadius={4}
      labelStyle={{ fontSize: 9, fill: theme.stroke }}
    />
  );
}
