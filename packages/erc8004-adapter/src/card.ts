import { canonicalJson } from "@clb-acel/evidence-core";
import type { AgentCard, HexString } from "@clb-acel/schemas";
import { keccak256, toBytes } from "viem";

/** Agent card fields excluding the derived integrity hash. */
export type AgentCardInput = Omit<AgentCard, "metadataHash">;

/** keccak256 over the canonical JSON of the card minus its own metadataHash. */
export function computeMetadataHash(card: AgentCardInput | AgentCard): HexString {
  const { metadataHash: _metadataHash, ...rest } = card as AgentCard;
  void _metadataHash;
  return keccak256(toBytes(canonicalJson(rest)));
}

/** Attach a deterministic `metadataHash` to a card input. */
export function finalizeAgentCard(input: AgentCardInput): AgentCard {
  return { ...input, metadataHash: computeMetadataHash(input) };
}
