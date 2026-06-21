import { describe, expect, it } from "bun:test";
import { finalizeAgentCard } from "../src/card";
import {
  createCanonicalErc8004Registry,
  isRegistrationV1,
  mapCanonicalToCard,
  mapRegistrationV1ToCard,
} from "../src/canonical-reader";

const baseCard = finalizeAgentCard({
  agentId: "1978",
  name: "Merchant",
  description: "Canonical agent",
  serviceEndpoints: ["https://example.test/.well-known/agent-card.json"],
  owner: "0x1111111111111111111111111111111111111111",
  authorizedSigningKeys: ["0x2222222222222222222222222222222222222222"],
  authorizedPaymentKeys: ["0x2222222222222222222222222222222222222222"],
  supportedProtocols: ["ERC8004"],
});

describe("mapCanonicalToCard", () => {
  it("adds the on-chain agentWallet to authorizedPaymentKeys and recomputes metadataHash", () => {
    const wallet = "0x3333333333333333333333333333333333333333";
    const card = mapCanonicalToCard({
      agentId: "1978",
      owner: "0x4444444444444444444444444444444444444444",
      agentWallet: wallet,
      fetchedCard: baseCard,
    });
    expect(card.agentId).toBe("1978");
    expect(card.owner).toBe("0x4444444444444444444444444444444444444444");
    expect(card.authorizedPaymentKeys.map((k) => k.toLowerCase())).toContain(wallet.toLowerCase());
    expect(card.metadataHash).not.toBe(baseCard.metadataHash); // owner+keys changed → hash changes
  });

  it("does not duplicate a wallet already authorized", () => {
    const card = mapCanonicalToCard({
      agentId: "1978",
      owner: baseCard.owner,
      agentWallet: "0x2222222222222222222222222222222222222222",
      fetchedCard: baseCard,
    });
    expect(card.authorizedPaymentKeys).toHaveLength(1);
  });
});

const weatherRegistration = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "CLB-ACEL Weather Agent",
  description: "Returns a weather update for a city.",
  image: "",
  services: [{ name: "weather", endpoint: "https://demo.vercel.app/api/weather" }],
  x402Support: true,
  active: true,
  supportedTrust: ["cross-layer-binding"],
};

describe("createCanonicalErc8004Registry", () => {
  const registry = createCanonicalErc8004Registry({
    rpcUrl: "https://sepolia.base.org",
    registryAddr: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    chainId: 84532,
  });

  it("returns null (not 500) for a non-numeric agentId like 'shopping-agent-001'", async () => {
    const result = await registry.getAgent("shopping-agent-001");
    expect(result).toBeNull();
  });
});

describe("registration-v1 bridge", () => {
  it("detects a registration-v1 card and rejects our AgentCard shape", () => {
    expect(isRegistrationV1(weatherRegistration)).toBe(true);
    expect(isRegistrationV1(baseCard)).toBe(false);
  });

  it("maps registration-v1 services → serviceEndpoints and derives protocols", () => {
    const card = mapRegistrationV1ToCard(weatherRegistration, "42");
    expect(card.agentId).toBe("42");
    expect(card.name).toBe("CLB-ACEL Weather Agent");
    expect(card.serviceEndpoints).toContain("https://demo.vercel.app/api/weather");
    expect(card.supportedProtocols).toContain("ERC8004");
    expect(card.supportedProtocols).toContain("x402");
    expect(card.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("composes with mapCanonicalToCard to overlay the on-chain owner + verified wallet", () => {
    const base = mapRegistrationV1ToCard(weatherRegistration, "42");
    const wallet = "0x3333333333333333333333333333333333333333";
    const full = mapCanonicalToCard({
      agentId: "42",
      owner: "0x4444444444444444444444444444444444444444",
      agentWallet: wallet,
      fetchedCard: base,
    });
    expect(full.owner).toBe("0x4444444444444444444444444444444444444444");
    expect(full.authorizedPaymentKeys.map((k) => k.toLowerCase())).toContain(wallet.toLowerCase());
    expect(full.authorizedSigningKeys.map((k) => k.toLowerCase())).toContain(wallet.toLowerCase());
  });
});
