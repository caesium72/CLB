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

function keccakHex(input: string | Uint8Array): `0x${string}` {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

export function hashEvidenceEvent(event: EvidenceEvent): `0x${string}` {
  const { signature: _signature, ...eventWithoutSignature } = event;
  void _signature;
  return keccakHex(canonicalJson(eventWithoutSignature));
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
