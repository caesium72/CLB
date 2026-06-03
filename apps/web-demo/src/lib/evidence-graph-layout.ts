import type { EvidenceGraph, EvidenceGraphEdge, EvidenceGraphNode } from "@clb-acel/schemas";
import type { Edge, Node } from "@xyflow/react";

const NODE_WIDTH = 168;
const NODE_HEIGHT = 88;
const H_GAP = 72;

export type EvidenceNodeData = {
  graphNode: EvidenceGraphNode;
  index: number;
};

export type EvidenceEdgeData = {
  edgeType: EvidenceGraphEdge["edgeType"];
  label?: string;
  layer: "integrity" | "semantic";
};

export function layoutEvidenceGraph(graph: EvidenceGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((graphNode, index) => ({
    id: graphNode.id,
    type: "evidenceNode",
    position: { x: index * (NODE_WIDTH + H_GAP), y: 0 },
    data: { graphNode, index } satisfies EvidenceNodeData,
    draggable: false,
    selectable: true,
  }));

  const edges: Edge[] = graph.edges.map((edge) => {
    const layer: EvidenceEdgeData["layer"] = edge.edgeType === "BINDS_TO" ? "integrity" : "semantic";
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: layer === "integrity" ? "bindsToEdge" : "semanticEdge",
      data: { edgeType: edge.edgeType, label: edge.label, layer } satisfies EvidenceEdgeData,
      animated: layer === "semantic",
      zIndex: layer === "integrity" ? 0 : 1,
    };
  });

  return { nodes, edges };
}

export function graphDimensions(nodeCount: number) {
  const width = Math.max(640, nodeCount * (NODE_WIDTH + H_GAP) + 48);
  const height = 280;
  return { width, height, nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT };
}
