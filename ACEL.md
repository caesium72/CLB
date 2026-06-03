Frankly, **“cross-protocol trust and audit framework” means a middleware layer that watches an agentic transaction across multiple protocols and proves later that every step was consistent.**

It is **not** a new payment protocol. It is more like a **black box recorder + deterministic verifier** for AI-agent commerce.

Today each protocol gives proof for its own layer:

- **AP2** proves user authorization through mandates and receipts.
- **ACP** handles the merchant checkout/session flow.
- **x402** handles HTTP-native payment and settlement.
- **ERC-8004** gives agent identity, reputation, and validation registries.

But the hard question is:

> Can we prove that the same user intent led to the same checkout, paid the same merchant, by the same authorized agent, with the same settlement, and then produced trustworthy feedback?

That cross-layer proof is the framework.

---

# 1. Why this is actually a gap

AP2 already gives mandate-level proof. It defines Checkout Mandates, Payment Mandates, receipts, human-present and human-not-present flows, and verification rules. But AP2 explicitly says the details of the commerce protocol — catalog APIs, checkout updates, and specific communication APIs — are outside AP2 scope. It also says automated retrieval of checkout evidence would be useful, but is outside the current version. ([AP2 Protocol][1])

ERC-8004 defines identity, reputation, and validation registries, but it says payments are orthogonal and not covered by the protocol. ([Ethereum Improvement Proposals][2])

x402 provides verification and settlement through a facilitator, but the facilitator is mainly concerned with payment verification/settlement, not whether the payment corresponds to a valid AP2 mandate or ACP checkout. ([x402][3])

ACP connects buyers, agents, sellers, and payment providers, and its latest stable spec includes checkout APIs, delegate payment spec, JSON schemas, and examples. But ACP itself is a commerce protocol, not a unified audit layer across AP2/x402/ERC-8004. ([GitHub][4])

So the research gap is not:

> “There is no authorization.”

Because AP2 has that.

The real gap is:

> “There is no standard cross-protocol evidence graph that binds authorization, checkout, settlement, delivery, and reputation into one verifiable trace.”

That is where your contribution can live.

---

# 2. Simple example

Suppose the user says:

> “Buy me one API-based token-risk report from a verified agent. Spend maximum $2.”

The system uses:

```txt
ERC-8004 → find a trusted analysis agent
AP2      → user signs spending constraints
x402     → pay the agent’s API
ACP      → if this was a merchant checkout flow
```

Without your framework, logs are scattered:

```txt
AP2 has mandates
x402 has payment result
ACP has checkout session
ERC-8004 has agent identity/reputation
```

Your framework creates one trace:

```txt
Trace #abc123

1. User intent:
   "Buy token-risk report, max $2"

2. Agent identity:
   ERC-8004 agentId = 42

3. AP2 authorization:
   mandate_hash = 0xaaa...

4. Service/checkout object:
   checkout_or_task_hash = 0xbbb...

5. x402 payment:
   payTo = 0xAgentWallet
   amount = 2 USDC
   txHash = 0xccc...

6. Delivery:
   report_hash = 0xddd...

7. Feedback:
   ERC-8004 feedback references trace #abc123
```

Then your verifier asks:

```txt
Did the agentId match the authorized agent?
Did the payment amount stay below the mandate limit?
Did x402 pay the same payee expected by the mandate/checkout?
Did the checkout/task hash match what the user authorized?
Was the same mandate reused?
Was the delivered result linked to the paid task?
Was feedback posted only after a real transaction?
```

That is the core idea.

---

# 3. What you would actually implement

I would name the project something like:

> **ACEL: Agentic Commerce Evidence Layer**

or

> **CAPS: Cross-Protocol Agent Payment/Commerce Security Layer**

The system has five parts.

---

## Part A — Evidence collector

This is middleware that sits beside your agent, merchant server, and payment server.

It captures important protocol objects:

```txt
From AP2:
- open checkout mandate
- closed checkout mandate
- payment mandate
- checkout receipt
- payment receipt

From ACP:
- checkout session id
- cart items
- cart hash
- merchant id
- total amount
- payment handler
- checkout state

From x402:
- payment requirements
- payment payload hash
- facilitator verification result
- settlement transaction hash
- network, asset, amount, payTo

From ERC-8004:
- agentId
- agentURI
- owner
- service endpoint
- reputation/validation reference
```

You do not need to store all private data publicly. You store hashes and selectively revealed fields.

Example canonical event:

```json
{
  "trace_id": "trace_123",
  "event_id": "evt_004",
  "protocol": "x402",
  "object_type": "settlement",
  "actor": "resource_server",
  "timestamp": "2026-05-29T10:30:00Z",
  "object_hash": "0x9ab...",
  "previous_event_hash": "0x71c...",
  "public_fields": {
    "network": "eip155:84532",
    "asset": "USDC",
    "amount": "2.00",
    "payTo": "0xMerchantOrAgent"
  },
  "private_ref": "s3://audit-bucket/trace_123/x402_payload.enc",
  "signature": "0xsigned_by_resource_server"
}
```

The important trick is the `previous_event_hash`. This creates a tamper-evident chain.

```txt
intent → mandate → checkout → payment → settlement → delivery → feedback
```

If someone changes an earlier event, the hash chain breaks.

---

## Part B — Evidence graph

Instead of flat logs, model the transaction as a graph.

```txt
UserIntent
   ↓ authorizes
AP2 Mandate
   ↓ constrains
ACP Checkout / Service Task
   ↓ paid by
x402 Settlement
   ↓ produces
Delivery Artifact
   ↓ supports
ERC-8004 Feedback
```

A simplified graph schema:

```ts
type EvidenceNode =
  | "USER_INTENT"
  | "AP2_OPEN_MANDATE"
  | "AP2_CLOSED_MANDATE"
  | "ACP_CHECKOUT"
  | "X402_PAYMENT_REQUIREMENT"
  | "X402_SETTLEMENT"
  | "DELIVERY_PROOF"
  | "ERC8004_AGENT_IDENTITY"
  | "ERC8004_FEEDBACK";

type EvidenceEdge =
  | "AUTHORIZES"
  | "BINDS_TO"
  | "PAYS_FOR"
  | "DELIVERS"
  | "RATES"
  | "VALIDATES";
```

This becomes your research object: **a cross-protocol evidence graph for agentic commerce.**

---

## Part C — Deterministic verifier

The verifier is the heart of the contribution.

It should not use an LLM. It should be deterministic code.

Example verification rules:

```txt
Rule 1: Agent binding
AP2 authorized_agent_key must match ERC-8004 agent registration key.

Rule 2: Amount binding
x402 amount must be <= AP2 payment mandate max_amount.

Rule 3: Payee binding
x402 payTo must match merchant/agent payee authorized in AP2 or ACP.

Rule 4: Checkout binding
AP2 checkout_hash must match ACP checkout/cart hash.

Rule 5: Currency/network binding
x402 network and asset must match allowed mandate constraints.

Rule 6: Nonce/replay protection
Same mandate nonce cannot settle two successful payments.

Rule 7: Delivery binding
delivery_hash must be created after successful settlement and linked to the paid task.

Rule 8: Feedback binding
ERC-8004 feedback is valid only if it references a verified completed trace.
```

Pseudo-code:

```ts
function verifyTrace(trace: EvidenceGraph): VerificationResult {
  assertHashChain(trace.events);

  const agent = trace.get("ERC8004_AGENT_IDENTITY");
  const mandate = trace.get("AP2_PAYMENT_MANDATE");
  const checkout = trace.get("ACP_CHECKOUT");
  const payment = trace.get("X402_SETTLEMENT");
  const delivery = trace.get("DELIVERY_PROOF");

  if (mandate.authorizedAgentKey !== agent.publicKey) {
    return fail("AGENT_KEY_MISMATCH");
  }

  if (payment.amount > mandate.constraints.maxAmount) {
    return fail("AMOUNT_EXCEEDS_MANDATE");
  }

  if (payment.payTo !== checkout.expectedPayee) {
    return fail("PAYEE_MISMATCH");
  }

  if (mandate.checkoutHash !== hash(checkout.normalizedCart)) {
    return fail("CHECKOUT_HASH_MISMATCH");
  }

  if (!mandate.constraints.allowedAssets.includes(payment.asset)) {
    return fail("ASSET_NOT_ALLOWED");
  }

  if (isNonceReused(mandate.nonce)) {
    return fail("MANDATE_REPLAY");
  }

  if (delivery.taskHash !== checkout.taskHash) {
    return fail("DELIVERY_NOT_BOUND_TO_TASK");
  }

  return pass("TRACE_VERIFIED");
}
```

This is publishable because you are converting vague “trust” into checkable invariants.

---

## Part D — Audit anchor smart contract

You do **not** need to put every event on-chain. That would be expensive and privacy-invasive.

Instead:

1. Store full encrypted evidence in S3/IPFS/local database.
2. Build a Merkle tree over event hashes.
3. Put only the Merkle root on-chain.

Example Solidity contract:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgenticAuditAnchor {
    struct TraceAnchor {
        bytes32 merkleRoot;
        bytes32 traceHash;
        address submitter;
        uint256 timestamp;
        string metadataURI;
    }

    mapping(bytes32 => TraceAnchor) public anchors;

    event TraceAnchored(
        bytes32 indexed traceId,
        bytes32 merkleRoot,
        bytes32 traceHash,
        address indexed submitter,
        string metadataURI
    );

    function anchorTrace(
        bytes32 traceId,
        bytes32 merkleRoot,
        bytes32 traceHash,
        string calldata metadataURI
    ) external {
        require(anchors[traceId].timestamp == 0, "Already anchored");

        anchors[traceId] = TraceAnchor({
            merkleRoot: merkleRoot,
            traceHash: traceHash,
            submitter: msg.sender,
            timestamp: block.timestamp,
            metadataURI: metadataURI
        });

        emit TraceAnchored(
            traceId,
            merkleRoot,
            traceHash,
            msg.sender,
            metadataURI
        );
    }
}
```

This gives you:

```txt
off-chain rich evidence
+ on-chain tamper timestamp
+ public verifiability
```

That is enough for a strong demo.

---

## Part E — Attack simulator / benchmark

This is where the research contribution becomes stronger than just a demo.

You create attacks and show that individual protocols alone may not detect the full cross-layer inconsistency, but your evidence verifier can.

Useful attack cases:

### Attack 1: Payee substitution

The agent is authorized to pay Merchant A, but x402 payment goes to Wallet B.

```txt
AP2 mandate: pay Merchant A
x402 settlement: pay Wallet B
Verifier result: PAYEE_MISMATCH
```

### Attack 2: Cart switch

User approved Product X, but merchant/agent submits Product Y.

```txt
AP2 checkout_hash: hash(Product X)
ACP cart_hash: hash(Product Y)
Verifier result: CHECKOUT_HASH_MISMATCH
```

AP2 already protects some of this inside its own mandate model, but the research value is showing it across ACP/x402/agent identity boundaries.

### Attack 3: Over-budget settlement

```txt
AP2 max_amount: $2
x402 payment: $3
Verifier result: AMOUNT_EXCEEDS_MANDATE
```

### Attack 4: Mandate replay

```txt
Same mandate used for two payments
Verifier result: MANDATE_REPLAY
```

Runtime/replay problems are already discussed in recent AP2 runtime-verification work, which argues that real agent executions introduce retries, concurrency, and orchestration problems beyond static mandate issuance. ([arXiv][5])

### Attack 5: Decision-layer manipulation

The payment is technically valid, but the agent chose the wrong merchant/product because of prompt injection.

This is important because a 2026 AP2 red-teaming paper argues that cryptographic guarantees can ensure execution correctness but do not protect the agent’s decision-making layer. ([arXiv][6])

Your framework can detect some decision attacks if you log:

```txt
candidate products
ranking reason
selected product
user constraints
merchant metadata hash
prompt-injection scanner output
```

But be honest: it cannot magically prove “the best choice.” It can prove whether the chosen action was consistent with auditable constraints.

### Attack 6: Payment without delivery

x402 can prove payment settlement, but not always end-to-end service delivery. A402, published in March 2026, explicitly argues that x402 lacks end-to-end atomicity across service execution, payment, and result delivery, and proposes Atomic Service Channels. ([arXiv][7])

Your framework can include:

```txt
delivery_hash
API response hash
model output hash
timestamp
server signature
```

This does not fully solve atomicity like A402 tries to, but it creates dispute evidence.

---

# 4. What would be the actual research contribution?

A weak paper would say:

> “We integrated x402, AP2, ACP, and ERC-8004.”

That is just engineering.

A stronger paper says:

> “We define and evaluate a cross-protocol evidence model for agentic commerce that detects inconsistencies across identity, authorization, checkout, payment, delivery, and reputation layers.”

Your contributions can be:

## Contribution 1: Formal evidence model

Define a canonical event schema and evidence graph:

```txt
E = {actor, protocol, object_type, object_hash, signature, timestamp, parent_hash}
G = (events, relations)
```

Then define invariants:

```txt
I1: authorized_agent == executing_agent
I2: checkout_hash == mandate.checkout_hash
I3: payment.amount <= mandate.max_amount
I4: payment.payTo == authorized_payee
I5: settlement.asset ∈ allowed_assets
I6: mandate.nonce is consumed once
I7: delivery.task_hash == paid_task_hash
I8: feedback requires verified completed trace
```

This is research-worthy because you are formalizing the composition boundary.

## Contribution 2: Reference implementation

Build:

```txt
Node.js agent orchestrator
Node.js merchant/ACP-like checkout server
x402 paid API endpoint on testnet
AP2-style mandate issuer/verifier
ERC-8004-style identity registry on testnet/local chain
Python verifier + attack simulator
AuditAnchor Solidity contract
```

You do not need full production ACP/AP2 integration initially. You can use their schemas/concepts and build a faithful testbed.

## Contribution 3: Evaluation benchmark

Evaluate:

```txt
Normal transactions
Payee substitution
Cart switch
Over-budget payment
Wrong asset/network
Mandate replay
Concurrent retry
Prompt-injected merchant metadata
Payment-without-delivery
Fake feedback
```

Metrics:

```txt
Detection rate
False positive rate
Verification latency
Storage overhead
On-chain anchoring cost
Privacy leakage
Developer integration complexity
```

## Contribution 4: Privacy-aware audit design

Because full checkout/payment logs may contain sensitive information, propose selective disclosure:

```txt
Public:
- hashes
- trace id
- protocol type
- amount range maybe
- verification result

Private/encrypted:
- full cart
- user identity
- address
- payment credential
- raw prompt
```

AP2 itself emphasizes selective disclosure and privacy around open mandates, so your design should follow that principle. ([AP2 Protocol][1])

---

# 5. Minimum viable demo architecture

Use this architecture:

```txt
User
 ↓
Shopping Agent
 ↓
AP2 Mandate Service
 ↓
ACP-like Merchant Checkout Server
 ↓
x402 Paid Resource Server
 ↓
Verifier / Evidence Graph
 ↓
AuditAnchor Smart Contract
 ↓
ERC-8004 Reputation Update
```

Tech stack:

```txt
Node.js:
- agent orchestrator
- merchant checkout API
- x402 resource server
- wallet/payment client

Python:
- verifier
- attack simulator
- evaluation scripts
- report generation

Solidity:
- AuditAnchor contract
- optional ERC-8004 mock registry

Storage:
- PostgreSQL for trace data
- S3/IPFS for encrypted evidence payloads
- EVM testnet for Merkle root anchoring

Deployment:
- AWS EC2/Lambda/ECS
- Base Sepolia or local Anvil/Hardhat chain
```

---

# 6. Example end-to-end flow for your demo

### Normal flow

```txt
1. User asks:
   “Buy token risk report, max $2.”

2. Agent resolves its own identity:
   ERC-8004 agentId = 7

3. User signs AP2-style open mandate:
   max_amount = 2 USDC
   task = token risk report
   authorized_agent = agentId 7

4. Agent calls paid API:
   GET /risk-report?token=XYZ

5. API returns:
   402 Payment Required

6. Agent pays using x402:
   amount = 2 USDC
   payTo = API wallet

7. API returns report.

8. Evidence collector logs:
   mandate hash
   payment hash
   settlement tx
   report hash

9. Verifier checks all invariants.

10. AuditAnchor stores Merkle root.

11. Optional:
   user posts ERC-8004 feedback referencing verified trace.
```

### Failed attack flow

```txt
1. User mandate says max $2.
2. Malicious agent tries to pay $5.
3. x402 payment may technically settle.
4. Your verifier flags:
   AMOUNT_EXCEEDS_MANDATE.
5. Trace is marked invalid.
6. No valid ERC-8004 feedback credential is issued.
```

This shows the framework is not replacing x402. It is adding cross-protocol accountability.

---

# 7. What should the paper claim?

Do **not** claim:

> “We solve secure agentic commerce.”

Too broad.

Claim:

> “We propose a cross-protocol evidence and verification layer that binds agent identity, mandate authorization, checkout/session state, payment settlement, and delivery evidence across emerging agentic-commerce protocols.”

Better title:

> **Composable Accountability for Agentic Commerce: A Cross-Protocol Evidence Layer for AP2, ACP, x402, and ERC-8004**

Possible research questions:

```txt
RQ1: Which security failures are missed when AP2, ACP, x402, and ERC-8004 are verified independently?

RQ2: Can a canonical evidence graph detect cross-protocol inconsistencies such as payee substitution, cart mismatch, mandate replay, and invalid feedback?

RQ3: What is the latency/storage/on-chain cost of adding this audit layer?

RQ4: How much private transaction information can be hidden while preserving verifiability?
```

---

# 8. Where novelty is strongest

The most defensible novelty is:

```txt
Cross-protocol composition verification.
```

Not:

```txt
AP2 mandates.
x402 payments.
ACP checkout.
ERC-8004 registry.
```

Those already exist.

Your original angle is:

> “When these protocols are composed, what new failure modes appear, and how can we verify the full transaction path?”

That is a real research angle because protocol composition often creates vulnerabilities even when each protocol is individually well-designed.

---

# 9. My honest view

This is a **good research direction**, but only if you keep it focused.

Bad version:

> “A blockchain-based AI payment system.”

Too generic. Crowded. Easy to dismiss.

Good version:

> “A verifiable evidence graph for cross-protocol agentic-commerce transactions, evaluated against concrete composition attacks.”

That gives you:

```txt
Clear problem
Clear system
Clear threat model
Clear evaluation
Clear contribution
```

My recommended MVP scope:

```txt
Implement AP2-style mandates + x402 testnet payment + ERC-8004-style identity + audit verifier first.

Add ACP-like checkout second.

Add real ACP spec compatibility later if time permits.
```

That sequence is practical and still research-valid.

[1]: https://ap2-protocol.org/ap2/specification/ "Agent Payments Protocol - AP2 - Agent Payments Protocol Documentation"
[2]: https://eips.ethereum.org/EIPS/eip-8004 "ERC-8004: Trustless Agents"
[3]: https://docs.x402.org/core-concepts/facilitator "Facilitator - x402"
[4]: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol "GitHub - agentic-commerce-protocol/agentic-commerce-protocol: The Agentic Commerce Protocol (ACP) is an interaction model and open standard for connecting buyers, their AI agents, and businesses to complete purchases seamlessly. The specification is currently maintained by OpenAI and Stripe. · GitHub"
[5]: https://arxiv.org/abs/2602.06345?utm_source=chatgpt.com "Zero-Trust Runtime Verification for Agentic Payment Protocols: Mitigating Replay and Context-Binding Failures in AP2"
[6]: https://arxiv.org/pdf/2601.22569?utm_source=chatgpt.com "Red-Teaming Google's Agent Payments Protocol via ..."
[7]: https://arxiv.org/abs/2603.01179?utm_source=chatgpt.com "A402: Bridging Web 3.0 Payments and Web 2.0 Services with Atomic Service Channels"
