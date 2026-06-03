import type { EvidenceGraph } from "@clb-acel/schemas";

export type EvidenceEventRow = {
  eventId: string;
  protocol: string;
  objectType: string;
  previousEventHash?: string;
};

export type EvidenceView = {
  traceId: string;
  events: EvidenceEventRow[];
  eventHashes: string[];
  merkleRoot: string;
  graph: EvidenceGraph;
};
