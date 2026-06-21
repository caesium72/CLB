import { expect, test } from "@playwright/test";

const traceId = "trace-phase5-ui";
const mandateId = "mandate-cart-phase5-ui";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.ethereum = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_signTypedData_v4") return `0x${"1".repeat(130)}`;
        if (method === "personal_sign") return `0x${"2".repeat(130)}`;
        if (method === "wallet_switchEthereumChain") return null;
        return null;
      },
    };
  });

  await page.route("**/api/demo/intent", async (route) => {
    await route.fulfill({
      json: {
        intentId: "intent-phase5-ui",
        task: "Buy a token-risk report for token XYZ",
        token: "XYZ",
        budget: "2.00",
        asset: "USDC",
        network: "base-sepolia",
      },
    });
  });

  await page.route("**/api/demo/discover", async (route) => {
    await route.fulfill({
      json: {
        selectedMerchantId: "analysis-agent-001",
        rationale: "Verified x402 merchant",
        activity: [
          { id: "search", label: "Searching ERC-8004 identity registry…", delayMs: 0 },
          { id: "select", label: "Selected Token Risk Analysis Agent", delayMs: 800, tone: "success" },
        ],
        payerAgent: { agentId: "shopping-agent-001", card: { name: "Shopping Agent" } },
        candidates: [
          {
            agentId: "analysis-agent-002",
            card: { name: "Unverified Token Scanner" },
            selected: false,
            rejectedReason: "Missing verified x402 settlement support",
          },
          { agentId: "analysis-agent-001", card: { name: "Token Risk Analysis Agent" }, selected: true },
        ],
      },
    });
  });

  await page.route("**/api/demo/quote", async (route) => {
    await route.fulfill({
      json: {
        kind: "cart",
        product: "Token-risk report for XYZ",
        merchantName: "Token Risk Analysis Agent",
        merchantAgentId: "analysis-agent-001",
        price: "2.00",
        maxAmount: "2.00",
        asset: "USDC",
        payee: "0x2222222222222222222222222222222222222222",
        network: "base-sepolia",
        settlementDescriptor: {},
      },
    });
  });

  await page.route("**/api/demo/prepare", async (route) => {
    await route.fulfill({
      json: {
        mandateDraft: {
          mandateId,
          type: "CART",
          humanPrincipal: "0x1111111111111111111111111111111111111111",
          authorizedAgent: {
            chainId: 31337,
            registryAddr: "0x0000000000000000000000000000000000000001",
            agentId: "shopping-agent-001",
          },
          constraints: {
            maxAmount: "2.00",
            allowedAssets: ["USDC"],
            allowedPayees: ["0x2222222222222222222222222222222222222222"],
            validUntil: "2026-05-30T05:10:00.000Z",
          },
        },
        clbDomain: { name: "CLB-ACEL", version: "0.1", chainId: 31337 },
        clb: {
          identityRef: {
            chainId: 31337,
            registryAddr: "0x0000000000000000000000000000000000000001",
            agentId: "shopping-agent-001",
          },
          settlementDescriptor: {
            chainId: 31337,
            network: "base-sepolia",
            asset: "USDC",
            payTo: "0x2222222222222222222222222222222222222222",
            value: "2.00",
            validBefore: "2026-05-30T05:10:00.000Z",
            x402Scheme: "exact",
          },
          domain: { name: "CLB-ACEL", version: "0.1", chainId: 31337 },
        },
        expectedCommitment: `0x${"a".repeat(64)}`,
      },
    });
  });

  await page.route("**/api/demo/mandates/register", async (route) => {
    await route.fulfill({ json: { mandate: { mandateId }, verification: { valid: true, reasons: [] } } });
  });

  await page.route("**/api/demo/probe-402**", async (route) => {
    await route.fulfill({
      json: {
        status: 402,
        paymentRequired: {
          error: "Payment required",
          accepts: [{ scheme: "exact", network: "base-sepolia" }],
        },
      },
    });
  });

  await page.route("**/api/demo/run", async (route) => {
    await route.fulfill({
      json: {
        traceId,
        nonce: `0x${"b".repeat(64)}`,
        settlementDescriptor: { x402Scheme: "exact" },
        paymentRequirements: { accepts: [{ network: "base-sepolia", scheme: "exact" }] },
        paymentPayload: { authorization: { nonce: `0x${"b".repeat(64)}` } },
        settlement: {
          settled: true,
          value: "2.00",
          asset: "USDC",
          payTo: "0x2222222222222222222222222222222222222222",
          payer: "0x1111111111111111111111111111111111111111",
          nonce: `0x${"b".repeat(64)}`,
        },
      },
    });
  });

  await page.route(`**/api/demo/trace/${traceId}`, async (route) => {
    await route.fulfill({
      json: {
        traceId,
        nonce: `0x${"b".repeat(64)}`,
        paymentRequirements: { accepts: [{ network: "base-sepolia", scheme: "exact" }] },
        paymentPayload: { authorization: { nonce: `0x${"b".repeat(64)}` } },
        settlement: {
          settled: true,
          value: "2.00",
          asset: "USDC",
          payTo: "0x2222222222222222222222222222222222222222",
          payer: "0x1111111111111111111111111111111111111111",
          nonce: `0x${"b".repeat(64)}`,
        },
      },
    });
  });

  await page.route(`**/api/demo/evidence/${traceId}`, async (route) => {
    await route.fulfill({
      json: {
        traceId,
        events: [{ eventId: "evt-1-user_intent", protocol: "USER", objectType: "USER_INTENT" }],
        eventHashes: [`0x${"c".repeat(64)}`],
        merkleRoot: `0x${"d".repeat(64)}`,
        graph: { nodes: [{ id: "USER_INTENT", protocol: "USER", label: "Intent" }], edges: [] },
      },
    });
  });
});

test("walks through intent, discovery, quote, mandate, checkout, and evidence", async ({ page }) => {
  await page.goto("/intent");
  await page.getByRole("button", { name: "Send to agent" }).click();
  await expect(page).toHaveURL(/\/discovery/);

  await page.getByRole("link", { name: "Continue to quote" }).click();
  await expect(page).toHaveURL(/\/quote/);

  await page.getByRole("link", { name: "Continue to authorize" }).click();
  await expect(page).toHaveURL(/\/mandate/);

  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Sign cart authorization" }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByRole("button", { name: "Agent pays" }).click();
  await expect(page).toHaveURL(new RegExp(`/payment\\?traceId=${traceId}`));
  await expect(page.getByText("Settled")).toBeVisible();

  await page.goto(`/evidence?traceId=${traceId}`);
  await expect(page.getByText("Live evidence-service")).toBeVisible();
});
