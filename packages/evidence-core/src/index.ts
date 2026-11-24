import type {
  EvidenceEdge,
  EvidenceEvent,
  EvidenceGraph,
  EvidenceGraphNode,
  EvidenceNode,
} from "@clb-acel/schemas";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { keccak_256 } from "@noble/hashes/sha3";

export const ZERO_HASH = `0x${"0".repeat(64)}` as const;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize non-finite number");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }

  throw new Error(`Cannot canonicalize ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** keccak256 over the canonical JSON encoding; shared by causal commitments. */
export function keccakCanonical(value: unknown): `0x${string}` {
  return keccakHex(canonicalJson(value));
}

function keccakHex(input: string | Uint8Array): `0x${string}` {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Hash the WHOLE event, including `signature`. Excluding it let an attacker
 * swap an event's signature without changing its hash, chain link or Merkle
 * leaf. Unicode/canonical ordering is handled by `canonicalJson`.
 */
export function hashEvidenceEvent(event: EvidenceEvent): `0x${string}` {
  return keccakHex(canonicalJson(event));
}

export function linkEvidenceEvents(events: EvidenceEvent[]): EvidenceEvent[] {
  return events.reduce<EvidenceEvent[]>((linked, event, index) => {
    if (index === 0) {
      const { previousEventHash: _previousEventHash, ...firstEvent } = event;
      void _previousEventHash;
      return [firstEvent];
    }

    const previous = linked[index - 1];
    if (!previous) {
      return linked;
    }

    return [
      ...linked,
      {
        ...event,
        previousEventHash: hashEvidenceEvent(previous),
      },
    ];
  }, []);
}

export function buildMerkleRoot(eventHashes: string[]): `0x${string}` {
  if (eventHashes.length === 0) {
    return ZERO_HASH;
  }

  let level = eventHashes.map((hash) => hexToBytes(strip0x(hash)));

  while (level.length > 1) {
    const nextLevel: Uint8Array[] = [];

    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;

      if (!left || !right) {
        throw new Error("Invalid Merkle level");
      }

      nextLevel.push(keccak_256(new Uint8Array([...left, ...right])));
    }

    level = nextLevel;
  }

  const [root] = level;
  if (!root) {
    return ZERO_HASH;
  }

  return `0x${bytesToHex(root)}`;
}

/** Membership proof using the same binary keccak(left‖right) + duplicate-last encoding as `buildMerkleRoot`. */
export type MerkleProof = {
  leaf: `0x${string}`;
  index: number;
  leafCount: number;
  siblings: `0x${string}`[];
};

export function buildMerkleProof(eventHashes: string[], index: number): MerkleProof {
  if (!Number.isInteger(index) || index < 0 || index >= eventHashes.length) {
    throw new Error("Merkle proof index out of range");
  }
  const leaves = eventHashes.map((hash) => hexToBytes(strip0x(hash)));
  let level = leaves;
  let cursor = index;
  const siblings: `0x${string}`[] = [];

  while (level.length > 1) {
    const pairIndex = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    // Mirrors `right = level[index + 1] ?? left` in buildMerkleRoot.
    const sibling = level[pairIndex] ?? level[cursor];
    if (!sibling) throw new Error("Invalid Merkle level");
    siblings.push(`0x${bytesToHex(sibling)}`);

    const nextLevel: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left;
      if (!left || !right) throw new Error("Invalid Merkle level");
      nextLevel.push(keccak_256(new Uint8Array([...left, ...right])));
    }
    level = nextLevel;
    cursor = Math.floor(cursor / 2);
  }

  return {
    leaf: `0x${bytesToHex(leaves[index]!)}`,
    index,
    leafCount: eventHashes.length,
    siblings,
  };
}

export function verifyMerkleProof(root: string, proof: MerkleProof): boolean {
  try {
    if (
      !Number.isInteger(proof.index) ||
      proof.index < 0 ||
      proof.index >= proof.leafCount ||
      proof.leafCount <= 0
    ) {
      return false;
    }
    if (proof.siblings.length !== Math.ceil(Math.log2(proof.leafCount))) return false;
    let hash = hexToBytes(strip0x(proof.leaf));
    if (hash.length !== 32) return false;
    let index = proof.index;
    for (const siblingHex of proof.siblings) {
      const sibling = hexToBytes(strip0x(siblingHex));
      if (sibling.length !== 32) return false;
      hash =
        index % 2 === 0
          ? keccak_256(new Uint8Array([...hash, ...sibling]))
          : keccak_256(new Uint8Array([...sibling, ...hash]));
      index = Math.floor(index / 2);
    }
    return strip0x(`0x${bytesToHex(hash)}`).toLowerCase() === strip0x(root).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Structural completeness audit for an event set produced by an untrusted agent.
 *
 * A hash chain and Merkle root bind events to EACH OTHER; they cannot prove that
 * the set is complete. This check covers only the cheap structural part: event
 * ids are unique and every object type required by the mandate/policy is
 * present. It does NOT prove authenticity or that a present event is genuine —
 * only comparing the Merkle root with a trusted external anchor does that.
 */
export type EvidenceSetAudit = {
  ok: boolean;
  reasons: string[];
};

export function auditEvidenceEventSet(
  events: EvidenceEvent[],
  requiredObjectTypes: readonly string[] = [],
): EvidenceSetAudit {
  const reasons: string[] = [];
  if (events.length === 0) {
    reasons.push("NO_EVENTS");
  }

  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.eventId)) {
      reasons.push(`DUPLICATE_EVENT_ID:${event.eventId}`);
    }
    seenIds.add(event.eventId);
  }

  const presentTypes = new Set(events.map((event) => event.objectType));
  for (const type of requiredObjectTypes) {
    if (!presentTypes.has(type)) {
      reasons.push(`MISSING_REQUIRED_OBJECT_TYPE:${type}`);
    }
  }

  return { ok: reasons.length === 0, reasons };
}

const nodeTypeByObjectType: Record<string, EvidenceNode> = {
  USER_INTENT: "USER_INTENT",
  ERC8004_AGENT_IDENTITY: "ERC8004_AGENT_IDENTITY",
  AP2_INTENT_MANDATE: "AP2_INTENT_MANDATE",
  AP2_CART_MANDATE: "AP2_CART_MANDATE",
  AP2_PAYMENT_MANDATE: "AP2_PAYMENT_MANDATE",
  ACP_CHECKOUT_OR_TASK: "ACP_CHECKOUT_OR_TASK",
  X402_PAYMENT_REQUIREMENT: "X402_PAYMENT_REQUIREMENT",
  X402_PAYMENT_PAYLOAD: "X402_PAYMENT_PAYLOAD",
  CHAIN_SETTLEMENT: "CHAIN_SETTLEMENT",
  DELIVERY_PROOF: "DELIVERY_PROOF",
  VERIFICATION_CERTIFICATE: "VERIFICATION_CERTIFICATE",
  ERC8004_FEEDBACK: "ERC8004_FEEDBACK",
  DECISION_CONTEXT: "DECISION_CONTEXT",
};

function nodeTypeFor(event: EvidenceEvent): EvidenceNode {
  return nodeTypeByObjectType[event.objectType] ?? "DELIVERY_PROOF";
}

/** Cross-protocol semantic edge between adjacent evidence nodes (CONTEXT §8.3). */
function semanticEdgeBetween(
  from: EvidenceNode,
  to: EvidenceNode,
): { edgeType: EvidenceEdge; label: string } | null {
  if (
    from === "ERC8004_AGENT_IDENTITY" &&
    (to === "AP2_CART_MANDATE" ||
      to === "AP2_INTENT_MANDATE" ||
      to === "AP2_PAYMENT_MANDATE" ||
      to === "ACP_CHECKOUT_OR_TASK")
  ) {
    return { edgeType: "AUTHORIZES", label: "identity authorizes" };
  }
  if (
    (from === "AP2_CART_MANDATE" ||
      from === "AP2_INTENT_MANDATE" ||
      from === "AP2_PAYMENT_MANDATE" ||
      from === "ACP_CHECKOUT_OR_TASK") &&
    to === "X402_PAYMENT_REQUIREMENT"
  ) {
    return { edgeType: "AUTHORIZES", label: "mandate authorizes" };
  }
  if (from === "X402_PAYMENT_REQUIREMENT" && to === "X402_PAYMENT_PAYLOAD") {
    return { edgeType: "PAYS_FOR", label: "pays for" };
  }
  if (from === "X402_PAYMENT_PAYLOAD" && to === "CHAIN_SETTLEMENT") {
    return { edgeType: "SETTLES", label: "settles on-chain" };
  }
  if (from === "CHAIN_SETTLEMENT" && to === "DELIVERY_PROOF") {
    return { edgeType: "DELIVERS", label: "unlocks delivery" };
  }
  if (from === "DELIVERY_PROOF" && to === "VERIFICATION_CERTIFICATE") {
    return { edgeType: "VALIDATES", label: "validates trace" };
  }
  if (from === "VERIFICATION_CERTIFICATE" && to === "ERC8004_FEEDBACK") {
    return { edgeType: "RATES", label: "rates agent" };
  }
  if (from === "ERC8004_AGENT_IDENTITY" && to === "DECISION_CONTEXT") {
    return { edgeType: "CONSIDERED", label: "considers candidates" };
  }
  if (
    from === "DECISION_CONTEXT" &&
    (to === "AP2_CART_MANDATE" ||
      to === "AP2_INTENT_MANDATE" ||
      to === "AP2_PAYMENT_MANDATE" ||
      to === "ACP_CHECKOUT_OR_TASK")
  ) {
    return { edgeType: "SELECTED", label: "selected merchant" };
  }
  return null;
}

export function buildEvidenceGraph(events: EvidenceEvent[]): EvidenceGraph {
  const sorted = [...events];
  const traceId = sorted[0]?.traceId ?? "";

  const nodes: EvidenceGraphNode[] = sorted.map((event) => ({
    id: event.eventId,
    nodeType: nodeTypeFor(event),
    label: event.objectType,
    protocol: event.protocol,
    objectHash: event.objectHash,
    metadata: {
      actor: event.actor,
      timestamp: event.timestamp,
      eventHash: hashEvidenceEvent(event),
      publicFields: event.publicFields,
      previousEventHash: event.previousEventHash,
    },
  }));

  const edges: EvidenceGraph["edges"] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;

    const fromType = nodeTypeFor(previous);
    const toType = nodeTypeFor(current);

    edges.push({
      id: `${previous.eventId}-hash-${current.eventId}`,
      source: previous.eventId,
      target: current.eventId,
      edgeType: "BINDS_TO",
      label: "hash chain",
    });

    const semantic = semanticEdgeBetween(fromType, toType);
    if (semantic) {
      edges.push({
        id: `${previous.eventId}-sem-${current.eventId}`,
        source: previous.eventId,
        target: current.eventId,
        edgeType: semantic.edgeType,
        label: semantic.label,
      });
    }
  }

  return {
    traceId,
    nodes,
    edges,
  };
}

// Causal delegation / execution provenance (Novelty 3).
export * from "./causal";

