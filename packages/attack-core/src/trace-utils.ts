import { buildMerkleRoot, hashEvidenceEvent, linkEvidenceEvents } from "@clb-acel/evidence-core";
import type { TraceBundle } from "@clb-acel/verifier-core";

export function recomputeEvidenceIntegrity(bundle: TraceBundle): TraceBundle {
  const events = linkEvidenceEvents(
    bundle.events.map(({ previousEventHash: _previousEventHash, ...event }) => event),
  );
  const eventHashes = events.map(hashEvidenceEvent);
  return {
    ...bundle,
    events,
    eventHashes,
    merkleRoot: buildMerkleRoot(eventHashes),
  };
}
