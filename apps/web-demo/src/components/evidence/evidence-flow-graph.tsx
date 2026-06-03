"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { EvidenceGraph, EvidenceGraphNode } from "@clb-acel/schemas";
import { BindsToEdge } from "@/components/evidence/binds-to-edge";
import { EvidenceEdgeLegend } from "@/components/evidence/evidence-edge-legend";
import { EvidenceFlowNode } from "@/components/evidence/evidence-flow-node";
import { SemanticEdge } from "@/components/evidence/semantic-edge";
import { graphDimensions, layoutEvidenceGraph } from "@/lib/evidence-graph-layout";
import { EDGE_THEME } from "@/lib/evidence-graph-theme";

const nodeTypes = { evidenceNode: EvidenceFlowNode };
const edgeTypes = { bindsToEdge: BindsToEdge, semanticEdge: SemanticEdge };

type EvidenceFlowGraphProps = {
  graph: EvidenceGraph;
  onSelectNode?: (node: EvidenceGraphNode | null) => void;
};

function EvidenceFlowGraphInner({ graph, onSelectNode }: EvidenceFlowGraphProps) {
  const { nodes, edges } = useMemo(() => layoutEvidenceGraph(graph), [graph]);
  const dimensions = graphDimensions(graph.nodes.length);
  const [selectedId, setSelectedId] = useState<string | null>(graph.nodes[0]?.id ?? null);

  const edgeTypesInGraph = useMemo(() => graph.edges.map((edge) => edge.edgeType), [graph.edges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedId(node.id);
      const graphNode = graph.nodes.find((item) => item.id === node.id) ?? null;
      onSelectNode?.(graphNode);
    },
    [graph.nodes, onSelectNode],
  );

  const arrowMarkers = useMemo(
    () =>
      (["AUTHORIZES", "PAYS_FOR", "SETTLES", "DELIVERS", "VALIDATES", "RATES"] as const).map(
        (edgeType) => {
          const color = EDGE_THEME[edgeType].stroke;
          return (
            <marker
              key={edgeType}
              id={`arrow-${edgeType}`}
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L8,4 L0,8 z" fill={color} />
            </marker>
          );
        },
      ),
    [],
  );

  return (
    <div className="space-y-4">
      <div
        className="overflow-x-auto rounded-lg border border-border bg-background"
        style={{ minHeight: dimensions.height }}
      >
        <div style={{ width: dimensions.width, height: dimensions.height }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            panOnScroll
            zoomOnScroll={false}
            minZoom={0.6}
            maxZoom={1.2}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "bindsToEdge" }}
          >
            <svg>
              <defs>{arrowMarkers}</defs>
            </svg>
            <Background gap={16} size={1} color="var(--border)" />
            <Controls showInteractive={false} className="!shadow-sm" />
          </ReactFlow>
        </div>
      </div>
      <EvidenceEdgeLegend edgeTypes={edgeTypesInGraph} />
      <p className="text-xs text-muted-foreground">
        Solid dashed spine = hash chain (BINDS_TO). Colored arcs = cross-protocol semantic edges
        from the ACEL evidence model.
        {selectedId ? ` Selected: ${selectedId}.` : null}
      </p>
    </div>
  );
}

export function EvidenceFlowGraph(props: EvidenceFlowGraphProps) {
  return (
    <ReactFlowProvider>
      <EvidenceFlowGraphInner {...props} />
    </ReactFlowProvider>
  );
}
