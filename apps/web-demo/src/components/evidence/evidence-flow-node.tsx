"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import type { EvidenceNodeData } from "@/lib/evidence-graph-layout";
import { protocolColors } from "@/lib/evidence-graph-theme";
import { cn } from "@/lib/utils";

function shortenLabel(label: string) {
  return label.replace(/_/g, " ").replace(/\b(AP2|X402|ERC8004)\b/g, (match) => match);
}

export const EvidenceFlowNode = memo(function EvidenceFlowNode({
  data,
  selected,
}: NodeProps & { data: EvidenceNodeData }) {
  const { graphNode, index } = data;
  const colors = protocolColors(graphNode.protocol);

  return (
    <div
      className={cn(
        "w-[168px] rounded-lg border-2 px-3 py-2 shadow-sm transition-shadow",
        colors.bg,
        colors.border,
        selected ? "ring-2 ring-primary ring-offset-2" : "",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-muted-foreground !bg-background"
      />
      <div className="mb-1 flex items-center justify-between gap-1">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", colors.text)}>
          {graphNode.protocol}
        </Badge>
        <span className="font-mono text-[10px] text-muted-foreground">#{index + 1}</span>
      </div>
      <p className="text-xs font-semibold leading-snug">{shortenLabel(graphNode.label)}</p>
      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{graphNode.id}</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-muted-foreground !bg-background"
      />
    </div>
  );
});
