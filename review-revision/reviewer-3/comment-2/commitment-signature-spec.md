# R3-C2 — Code-Evidenced Cryptographic Specification

**Scope.** Commitment construction, signature/authorization, nonce/replay, domain separation and
chain binding for A³C-VPEAL / CLB-ACEL, resolved against the *actual* implementation in
`E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`. Every statement below points to file:line evidence.
Nothing in the manuscript, package manifests, existing source, or existing tests was changed.
The only new artifacts are this document and
`packages/clb-core/test/commitment-vectors.test.ts`.

**Status vocabulary.** `IMPLEMENTED` = behaviour exists with cited evidence; `PARTIAL` = core
behaviour exists but a stated guarantee is narrower than the claim; `GAP` = required behaviour is
absent or contradicted by code. Status counts: **17 IMPLEMENTED / 7 PARTIAL / 4 GAP**.

---

## 0. Cryptographic primitives and exact parameters (evidence summary)

| Primitive | Exact algorithm / library | Evidence |
|---|---|---|
| Commitment `C` (Mode A) | `hashTypedData` (EIP-712 digest `keccak256(0x1901 ‖ domainSeparator ‖ structHash)`), viem | `packages/clb-core/src/index.ts:17,104-106` |
| Settlement commitment `C'` (Mode B) | `hashTypedData`, EIP-712 primary type `CLBSettlementCommitment` | `packages/clb-core/src/index.ts:188,254-256` |
| Digest leaves (mandate, settlement descriptor) | `keccak256(toBytes(canonicalJson(x)))`, viem `keccak256` = Keccak-256 | `packages/clb-core/src/index.ts:18,52-55,62-74` |
| Evidence event / Merkle hashing | `keccak_256` from `@noble/hashes/sha3` over UTF-8 bytes | `packages/evidence-core/src/index.ts:9,53-56,91-121` |
| Payment authorization signature | EIP-712 `account.signTypedData` / `verifyTypedData` / `recoverTypedDataAddress`, viem (secp256k1 ECDSA) | `packages/x402-adapter/src/index.ts:16-19,243-272` |
| Mandate signature (CART/PAYMENT) | EIP-712 `signCommitment` over `C` | `packages/clb-core/src/index.ts:114-138`; `packages/ap2-adapter/src/index.ts:148-152,222-229` |
| Mandate signature (INTENT) | EIP-191 `personal_sign` over the raw 32-byte mandate digest | `packages/ap2-adapter/src/index.ts:142-146,191-201,234-239` |
| Nonce | `keccak256(C)` (raw 32 bytes) — Solidity: `keccak256(abi.encodePacked(C))` | `packages/clb-core/src/index.ts:108-111`; `contracts/src/PredicatePaymentGuard.sol:139-142,184` |
| On-chain settlement param digest | `keccak256(abi.encode(chainId, network, asset, payTo, value, valueAtomic, validBefore, payerAgentId))` | `packages/clb-core/src/index.ts:199-224`; `contracts/src/PredicatePaymentGuard.sol:108-114` |

### 0.1 EIP-712 domain parameters (exact)

| Message | Domain name | Version | chainId | verifyingContract | Evidence |
|---|---|---|---|---|---|
| `CLBCommitment` / `CLBSettlementCommitment` | `CLB-ACEL` | `0.1` | `domain.chainId` | optional passthrough | `packages/schemas/src/index.ts:133-138`; `packages/clb-core/src/index.ts:76-83` |
| `PaymentAuthorization` | `CLB-ACEL-x402` | `0.1` | `auth.chainId` | none | `packages/x402-adapter/src/index.ts:97-117` |
| On-chain guard `C'` | `CLB-ACEL` | `0.1` | constructor `domainChainId` | **none** (3-field domain type) | `contracts/src/PredicatePaymentGuard.sol:48-49,58,77-86` |

### 0.2 Exact EIP-712 type strings and type hashes

Computed with `keccak256(toBytes(...))`; pinned by the new test file.

```
IdentityRef(uint256 chainId,address registryAddr,string agentId)
  = 0x8aa72cd3bef5cf63440d10d2c9cd3014b688ec4363b865971533ca0ae124dcd6

CLBCommitment(IdentityRef identityRef,bytes32 mandateDigest,bytes32 settlementDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)
  = 0x604b26243dd3518142fda62df2f9bfd240bdd7a5eefc8f632d1ce2c3a1cea2e8

CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)
  = 0x40f7efb502a5036de90c1db779f576d29708876cb40bfb92707b091562aa0e71

PaymentAuthorization(address from,address to,string value,string asset,string validBefore,bytes32 nonce,string network,uint256 chainId)
  = 0xd40c76159a130be3e50f210e516e7637ea1447830bed8ece8437b13cacbcb329

EIP712Domain(string name,string version,uint256 chainId)                    = 0xc2f8787176b8ac6bf7215b4adcc1e069bf4ab82d9ab1df05a57a91d425935b6e
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract) = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f
```

On-chain declarations: `contracts/src/PredicatePaymentGuard.sol:48-54`. Domain type hash for the
3-field domain is hard-coded there; viem derives the 4-field variant when `verifyingContract` is
supplied (`packages/clb-core/src/index.ts:81`). See item 26 for the parity consequence.

### 0.3 Field order (authoritative)

| Struct | Field order | Evidence |
|---|---|---|
| `IdentityRef` | `chainId` (uint256), `registryAddr` (address), `agentId` (string) | `packages/clb-core/src/index.ts:38-42,175-179`; `contracts/.../PredicatePaymentGuard.sol:22-26` |
| `CLBCommitment` | `identityRef`, `mandateDigest` (bytes32), `settlementDigest` (bytes32) | `packages/clb-core/src/index.ts:43-47` |
| `CLBSettlementCommitment` | `identityRef`, `mandateDigest`, `predicateId` (string), `settlementParamsDigest` (bytes32) | `packages/clb-core/src/index.ts:180-185` |
| `PaymentAuthorization` | `from`, `to`, `value`, `asset`, `validBefore`, `nonce`, `network`, `chainId` | `packages/x402-adapter/src/index.ts:84-95` |
| `SettlementParams` ABI | `chainId`, `network`, `asset`, `payTo`, `value`, `valueAtomic`, `validBefore`, `payerAgentId` | `packages/clb-core/src/index.ts:201-221`; `contracts/.../PredicatePaymentGuard.sol:28-37,110-114` |

### 0.4 Known deterministic vectors (from the new test file)

Fixed input: `chainId=84532`, `registryAddr=0x...0001`, `agentId=analysis-agent-001`,
mandate `mandate-1 / CART / humanPrincipal=user:0xabc / maxAmount 2.00`, settlement
`(base-sepolia, USDC, 0x...a1, 2.00, 2026-05-30T06:00:00.000Z, exact)`, domain
`(CLB-ACEL, 0.1, 84532)`.

| Quantity | Hex |
|---|---|
| `mandateDigest` | `0x31deaae3a1f93c309b430365ad8881c532532ee2ac06f816755b2eb47784dc28` |
| `settlementDigest` | `0xfaa4ca710737736a4c87c05739bfed31156f8e74eca62128d385432788fd7468` |
| domainSeparator(84532) | `0x101056d5d703ece53a7cf703aaf0d03a80ad7990bb7a5b4a28d6502cfc915f47` |
| `identityRefHash` | `0x5bf4e4831e02597fb76b438830d1776799bb2b80316240b25971662efe099a12` |
| EIP-712 `structHash` for `C` | `0xf81100bc5d8d8b96c07d41ec1a312bac5c5ec9517818f23152ef59d9cf057c7f` |
| **`C`** | `0x73c13de8e1f12c40ca31e199869524a83829694208376015a5f9056a2a380181` |
| **`nonce = H(C)`** | `0x001f7cda30d4bd6ccf176d33615ded12547290f2b8f91f5af1a8a72b576c2c52` |
| `settlementParamsDigest` (Mode B parity vector) | `0x31c3a08746fb658e8a0b0e70c47cd5cca15a72c6ec13868552188ab7b64474c8` |
| EIP-712 `structHash` for `C'` | `0x5985a134931ca7456632173e24bd183bda699c2a02aacde63c332861cf2b721d` |
| **`C'`** (`predicateId=pred-1`) | `0xbb7818631ee63e759970ca76975ad07199b8fa4e860b8d8d9ba9fbc6160e9747` |
| **`nonce' = H(C')`** | `0x7a2823f5e78b8675253cadf1d340bca42565e29c66769932ba5174a1542351ca` |
| `C` with domain.name = `OTHER` | `0xd1e49257264669607fa8ae625942a3abc9dbd2fc230cb77794f27a6e9db69372` |
| `C` with domain.version = `9.9` | `0x1fa4613516714f526906afb49be104adfb9c9f5a15c8e55f73530b06e9d05608` |
| `C` with domain.chainId = `1` | `0x9cb00b531535fe628a7bc861ec0e93a1397862a3e3fea0ab2a71b3d80591e97c` |

The `settlementParamsDigest` value is identical to the pre-existing TS↔Solidity parity anchor at
`packages/clb-core/test/settlement-commitment.test.ts:25-29`.

---

## 1. Exact hash algorithm

**Status: IMPLEMENTED.**

- `keccakCanonical` = `keccak256(toBytes(canonicalJson(value)))` using viem `keccak256`
  (`packages/clb-core/src/index.ts:18,52-55`); `deriveNonce` = `keccak256(commitment)` over the
  raw 32 bytes (`packages/clb-core/src/index.ts:108-111`); `computeSettlementParamsDigest` uses
  viem `keccak256(encodeAbiParameters(...))` (`packages/clb-core/src/index.ts:199-224`).
- Evidence events use `keccak_256` from `@noble/hashes/sha3`
  (`packages/evidence-core/src/index.ts:9,53-56`); certificate hashes use viem `keccak256`
  (`packages/verifier-core/src/index.ts:27,457-459`); x402 tx-hash simulation uses viem
  `keccak256` (`packages/x402-adapter/src/index.ts:15,275-277`).
- Solidity uses native `keccak256` throughout (`contracts/src/PredicatePaymentGuard.sol:48-54,
  110-114,116-118,136,139-142,184`).
- All are Keccak-256 (Ethereum variant), consistent across TS and Solidity. No SHA-256/NIST hash is
  used in these paths.
- **Test evidence:** vectors in §0.4 are asserted byte-exactly by the new test file.

## 2. Canonical serialization of commitment inputs (`canonicalJson`)

**Status: PARTIAL.**

- Implemented: `normalize` recursively filters `undefined` values (`packages/evidence-core/src/index.ts:40`),
  sorts object keys with `localeCompare` (`:41`), rejects non-finite numbers (`:26-31`), rejects
  non-JSON types (`:46`), and `canonicalJson` returns `JSON.stringify(normalize(value))` (`:49-51`).
- Used for the mandate digest and settlement digest leaves
  (`packages/clb-core/src/index.ts:62-74`), the simulated settlement tx hash
  (`packages/x402-adapter/src/index.ts:275-277`), the verification certificate hash
  (`packages/verifier-core/src/index.ts:457-459`) and evidence event hashes
  (`packages/evidence-core/src/index.ts:62-66`).
- **What is missing / weaker than a JCS claim:**
  1. The assembled commitment `C`/`C'` is *not* serialized by `canonicalJson`; it is EIP-712
     binary ABI encoding via `hashTypedData` (`packages/clb-core/src/index.ts:104-106,254-256`).
     Canonical JSON covers only the two 32-byte leaves.
  2. `localeCompare` (`:41`) is ICU/locale dependent, not RFC 8785 (JCS) UTF-16 byte ordering.
     All current field names are ASCII-lower-case so no divergence is observed, but the algorithm
     is not locale-independent by construction.
  3. `normalize` throws on `bigint` (`:46`); JS `number` values are serialized by
     `JSON.stringify` (`:26-31,50`), so integers beyond `Number.MAX_SAFE_INTEGER` are lossy.
     Current schemas avoid this by encoding amounts as strings
     (`packages/schemas/src/index.ts:83,126`).
  4. No schema validation at the hashing boundary — see item 4.
- **Test evidence:** new test asserts the byte-exact canonical form, key-order independence and
  `undefined`-omission.

## 3. Field ordering and encoding

**Status: IMPLEMENTED.**

- EIP-712 type declarations fix ordering: `IdentityRef` and `CLBCommitment`
  (`packages/clb-core/src/index.ts:37-48`), `CLBSettlementCommitment`
  (`:174-186`), `PaymentAuthorization` (`packages/x402-adapter/src/index.ts:84-95`).
- Solidity type-hash strings pin the same order (`contracts/src/PredicatePaymentGuard.sol:48-54`);
  ABI argument order is pinned at `:110-114` and `:116-118`.
- `canonicalJson` sorts keys (`packages/evidence-core/src/index.ts:37-44`), so object insertion
  order cannot change a digest.
- Encoding: `uint256`/`address`/`bytes32` fixed-width; dynamic `string` fields are keccak-hashed
  inside EIP-712 (`packages/clb-core/src/index.ts:93-98,201-221`). `chainId` is converted with
  `BigInt(...)` (`:93,213`); `valueAtomic` is bound as `uint256` (`:218`).
- **Test evidence:** new test asserts both type-struct JSON orderings and all type hashes.

## 4. Missing / optional field handling

**Status: PARTIAL.**

- Implemented: `undefined` object members are dropped by `canonicalJson`
  (`packages/evidence-core/src/index.ts:40`); `signature` and derived `clbCommitment` are excluded
  from the mandate digest (`packages/clb-core/src/index.ts:62-67`); `verifyingContract` is included
  in the EIP-712 domain only when present (`:76-83`); optional schema fields are declared
  (`packages/schemas/src/index.ts:49-60,71-72,97,137`); `attachMandateSignature` conditionally
  attaches a stored or recomputed commitment (`packages/ap2-adapter/src/index.ts:93-113`).
- **What is missing:** `computeCommitment` (`:104-106`), `computeSettlementDigest` (`:70-74`),
  `computeSettlementParamsDigest` (`:199-224`) and `deriveNonce` (`:108-111`) accept raw objects
  and never call `CLBCommitmentInputSchema.parse` (`packages/schemas/src/index.ts:140-147`).
  A required field passed as `undefined` is silently omitted from a canonical-JSON digest rather
  than rejected, or causes a downstream viem encoding error. There is no explicit
  missing-field diagnostic at the cryptographic boundary.
- **Test evidence:** new test covers intentional optional handling (`undefined` dropped, explicit
  `null` kept, signature/clbCommitment excluded) but cannot assert a validation error that does
  not exist.

## 5. Unambiguous field boundaries

**Status: IMPLEMENTED.**

- `C`/`C'` use EIP-712: fixed-width ABI encoding plus keccak of variable-length strings, with the
  `0x1901` version prefix and domain separator (`packages/clb-core/src/index.ts:104-106,254-256`;
  `contracts/src/PredicatePaymentGuard.sol:136`). This makes field boundaries unambiguous even
  for adjacent variable-length strings (`network`, `asset`, `value`, `validBefore`, `agentId`).
- Canonical JSON contributes quoted/escaped strings and structural delimiters
  (`packages/evidence-core/src/index.ts:49-51`).
- Caveat (not a collision found): `canonicalJson` collapses members whose value is `undefined`
  (`:40`) and relies on JS number formatting (`:26-31`); EIP-712 is the authoritative boundary
  mechanism for all signed structures.
- **Test evidence:** 15 field-mutation tests in the new file all change `C`.

## 6. Identity + mandate digest + settlement descriptor binding

**Status: IMPLEMENTED.**

- EIP-712 message for `C` contains exactly `identityRef`, `mandateDigest`, `settlementDigest`
  (`packages/clb-core/src/index.ts:86-101`); `settlementDigest` is the canonical hash of the whole
  descriptor (`:98,70-74`).
- `mandateDigest` covers the authorization fields (mandateId, type, humanPrincipal,
  authorizedAgent, constraints, optional parentMandateHash) with signature and `clbCommitment`
  removed (`packages/clb-core/src/index.ts:62-67`; `packages/ap2-adapter/src/index.ts:72-86`).
- Verifier recomputes the same binding (`packages/verifier-core/src/index.ts:84-91,211-228`), and
  the guard recomputes `C'` with the same leaves (`contracts/src/PredicatePaymentGuard.sol:120-137`).
- Mode B `C'` additionally binds `predicateId` and the ABI-encoded settlement params digest
  (`packages/clb-core/src/index.ts:174-186,199-224,235-256`).
- **Test evidence:** mandate sub-field mutation tests and all bound-field mutation tests.

## 7. Deterministic commitment test vectors

**Status: IMPLEMENTED (added by this revision).**

- Before this revision only `computeSettlementParamsDigest` had a pinned hex vector
  (`packages/clb-core/test/settlement-commitment.test.ts:25-29`); `computeCommitment` was only
  checked for self-consistency (`packages/clb-core/test/clb-core.test.ts:85-89`).
- The new test file pins: canonical settlement JSON, `mandateDigest`, `settlementDigest`, domain
  separator, identity ref hash, EIP-712 type hashes, `structHash(C)`, `C`, `nonce`,
  `settlementParamsDigest`, `structHash(C')`, `C'`, `nonce'`, payment type/domain hashes, and three
  domain-separation vectors (full table in §0.4).
- All values were produced by executing the implementation under test with Bun 1.4.5 / viem 2.x.

## 8. Tests proving modifying ANY bound field changes the commitment

**Status: IMPLEMENTED (added by this revision).**

- New test table mutates each of: `identityRef.chainId`, `identityRef.registryAddr`,
  `identityRef.agentId`, `mandateDigest`, all six exact settlement descriptor fields
  (`chainId`, `network`, `asset`, `payTo`, `value`, `validBefore`), `x402Scheme` (switch to a
  predicate descriptor), and all four domain fields (`name`, `version`, `chainId`,
  `verifyingContract`) — 15 mutations, each asserted to change `C`.
- A second test mutates 9 mandate authorization sub-fields and verifies both `mandateDigest` and
  `C` change.
- Prior partial coverage retained: `packages/clb-core/test/clb-core.test.ts:91-111,142-148`.

## 9. Exact signature algorithms + libraries

**Status: IMPLEMENTED.**

- `signCommitment` uses `privateKeyToAccount(...).signTypedData` (EIP-712),
  `recoverCommitmentSigner` uses `recoverTypedDataAddress`, `verifyCommitmentSignature` uses
  `verifyTypedData` (`packages/clb-core/src/index.ts:113-138`).
- Payment side: `signPaymentPayload` / `recoverPaymentSigner` / `verifyPaymentPayload`
  (`packages/x402-adapter/src/index.ts:242-272`) use the same viem EIP-712 APIs; the facilitator
  re-verifies before settling (`:373-376`).
- Mandate side: CART/PAYMENT use EIP-712 `signCommitment`
  (`packages/ap2-adapter/src/index.ts:148-152`); INTENT uses EIP-191 `personal_sign` over the raw
  32-byte mandate digest (`:142-146,191-201,234-239`).
- Underlying curve is secp256k1 ECDSA (viem default); 65-byte signatures. No alternate signature
  scheme is claimed.

## 10. Signed-message formats (EIP-712 type structs)

**Status: IMPLEMENTED.**

- `CLB_TYPED_DATA_TYPES` / `CLB_PRIMARY_TYPE` (`packages/clb-core/src/index.ts:37-50`),
  `CLB_SETTLEMENT_TYPED_DATA_TYPES` / `CLB_SETTLEMENT_PRIMARY_TYPE` (`:174-188`),
  `PAYMENT_AUTH_TYPES` (`packages/x402-adapter/src/index.ts:84-95`), and the payment domain builder
  (`:97-117`). Full type strings and hashes in §0.2.
- The on-chain guard declares the matching settlement type hash
  (`contracts/src/PredicatePaymentGuard.sol:52-54`).
- Caveat about the optional `verifyingContract` domain field is recorded in item 26; it is a
  *domain* parity issue, not a type-struct issue.

## 11. Mandate signature generation + verification

**Status: IMPLEMENTED.**

- Generation: `issueMandate` builds authorization fields, derives the digest, signs either the
  personal message (INTENT) or the CLB commitment EIP-712 payload (CART/PAYMENT)
  (`packages/ap2-adapter/src/index.ts:136-153`).
- Verification: `verifyMandate` resolves the expected signer, recomputes the mandate digest (`:189`),
  verifies EIP-191 for INTENT (`:191-201`) or recomputes `C` and verifies EIP-712 for CART/PAYMENT
  (`:203-231`). It fails closed when `clbCommitment` or the CLB context is missing (`:203-208`) or
  when the recomputed commitment differs (`:216-220`).
- Caveats: `attachMandateSignature` only attaches/splices a supplied signature and does not verify
  it (`:93-113`); verification needs caller-supplied CLB context (`:155-160,206-208`).

## 12. Payment authorization signatures

**Status: IMPLEMENTED.**

- `buildPaymentAuthorization` copies descriptor fields plus the CLB-derived nonce into the
  authorization (`packages/x402-adapter/src/index.ts:224-240`); `signPaymentPayload` signs the
  `PaymentAuthorization` EIP-712 struct (`:242-257`); recovery/verification at `:259-272`.
- `verifyPaymentPayload` verifies against `authorization.from` (`:269`) — the payer key, not the
  agent card (that check is R4, item 14).
- **Boundary of this guarantee:** the facilitator verifies only the signature and nonce freshness
  (`:373-385`); the equality `nonce == H(C)` is enforced by verifier rule R8
  (`packages/verifier-core/src/index.ts:267-290`), not by `verifyPaymentPayload`.

## 13. Human principal ↔ mandate relationship

**Status: IMPLEMENTED.**

- `humanPrincipal` is a required mandate field (`packages/schemas/src/index.ts:68`), populated from
  the signer address by default or an explicit address (`packages/ap2-adapter/src/index.ts:136-140`),
  bound into `mandateDigest` through `authorizationFields` (`:72-86`), and used as the default
  expected signature verifier (`:168-175,189`).
- Caveat: the schema types it as an arbitrary non-empty string (`:68`), so a non-address value
  yields `HUMAN_PRINCIPAL_NOT_AN_ADDRESS` at verification time (`:185-187`). The existing test
  fixture uses `humanPrincipal: "user:0xabc"` (`packages/clb-core/test/clb-core.test.ts:34`), which
  is suitable for digest vectors but would not pass `verifyMandate`.

## 14. Agent payment-key authorization

**Status: IMPLEMENTED.**

- `AgentCardSchema` carries `owner`, `authorizedSigningKeys`, `authorizedPaymentKeys`
  (`packages/schemas/src/index.ts:25-37`).
- R4 checks the settlement payer against the payer card's authorized payment keys
  (`packages/verifier-core/src/index.ts:200-204`); R12 checks the payee against the merchant card's
  authorized receiving keys (`:376-381`). Registry-level helpers use checksum-normalized address
  comparison (`packages/erc8004-adapter/src/index.ts:32-40`).
- Caveat: this is a verifier-side guarantee; the facilitator does not consult an agent card
  (`packages/x402-adapter/src/index.ts:373-385`).

## 15. Key ownership, rotation, revocation behaviour

**Status: GAP.**

- Present: `owner` on the card/record (`packages/schemas/src/index.ts:30`;
  `packages/erc8004-adapter/src/types.ts:5-14`), `authorizePaymentKey` / `authorizeSigningKey`
  (append-only) and whole-agent `setStatus` with `ACTIVE | SUSPENDED | REVOKED`
  (`packages/erc8004-adapter/src/index.ts:100-131`; `src/types.ts:3`), and metadataHash
  recomputation on card mutation (`:68-75`).
- **Wrong / missing:** there is no `revokePaymentKey`, no `rotatePaymentKey`, and no key-level
  removal anywhere in `Erc8004Registry` (`packages/erc8004-adapter/src/types.ts:37-44`).
  `authorizePaymentKey`, `authorizeSigningKey` and `setStatus` take no caller identity and perform
  no owner authentication (`packages/erc8004-adapter/src/index.ts:100-131`), so in the in-memory
  registry any caller can add keys or revoke an agent. The canonical on-chain registry is read-only
  (`:189-204`), so no on-chain rotation path exists. Revocation is only *modelled* in attack
  fixtures by emptying key arrays or setting status
  (`packages/attack-core/src/adversarial-sequences.ts:135`; `src/adversarial-matrix.ts:152`).
- **Test evidence:** new `GAP EVIDENCE 15` test asserts the missing API surface and a skipped test
  states the desired rotation semantics. No security-critical code was patched.

## 16. Authorization bound to transaction context

**Status: PARTIAL.**

- Bound and signed: `from`, `to`, `value`, `asset`, `validBefore`, `nonce`, `network`, `chainId`
  (`packages/x402-adapter/src/index.ts:51-61,84-95`); the CLB leaves additionally bind identity and
  mandate (`packages/clb-core/src/index.ts:86-101`); verifier R7 compares the receipt to the
  descriptor/concrete params (`packages/verifier-core/src/index.ts:230-265`).
- **What is missing:** the `resource` field of the payment requirement
  (`packages/x402-adapter/src/index.ts:35,141,186`) is not part of `PaymentAuthorization`, not in
  `PAYMENT_AUTH_TYPES` (`:84-95`), not in `settlementDigest`
  (`packages/clb-core/src/index.ts:70-74`), and not checked by R7/R12/R13. There is no request id
  or transaction hash inside the signed authorization. Consequently a signature is reusable for a
  *different resource* as long as payee/amount/asset/chain/expiry/nonce match (the nonce limits it
  to one settlement, but does not tie it to the intended request).

## 17. Nonce derivation algorithm

**Status: IMPLEMENTED.**

- `deriveNonce(commitment) = keccak256(commitment)` over the raw 32 bytes
  (`packages/clb-core/src/index.ts:108-111`); `deriveSettlementNonce` is an alias (`:258-261`).
- Solidity parity: `keccak256(abi.encodePacked(commitment))`
  (`contracts/src/PredicatePaymentGuard.sol:139-142,184`). `abi.encodePacked(bytes32)` is exactly
  the 32 bytes viem hashes.
- Verifier R8 recomputes and compares (`packages/verifier-core/src/index.ts:267-290`).
- **Test evidence:** new test asserts `deriveNonce(C) == keccak256(C) == VECTOR.nonce` for both
  `C` and `C'`.

## 18. Nonce validation bound to commitment + transaction context

**Status: IMPLEMENTED.**

- `checkNonceEqualsHashC` recomputes `C` (Mode A) or `C'` (Mode B) from the bundle and requires
  both `paymentPayload.authorization.nonce` and `settlement.nonce` to equal the derived nonce
  (`packages/verifier-core/src/index.ts:267-290`). Because `C` binds identity/mandate/settlement,
  changing any transaction-context field changes the expected nonce.
- On-chain `validateAndConsume` recomputes `C'`, checks `recomputed == commitment` and
  `expectedNonce == nonce` (`contracts/src/PredicatePaymentGuard.sol:181-185`).

## 19. One-time nonce consumption

**Status: IMPLEMENTED.**

- `createInMemoryNonceStore` tracks `consumed` receipts and `inFlight` reservations
  (`packages/x402-adapter/src/index.ts:335-363`); `inMemoryFacilitator.settle` reserves before
  settlement and commits after success (`:373-393`).
- On-chain guard has `mapping(bytes32 => bool) public consumed`, checks it, then sets it
  (`contracts/src/PredicatePaymentGuard.sol:61,188,197-198`).
- The validator enforces an analogous one-record-per-trace rule
  (`contracts/src/CrossLayerBindingValidator.sol:27-38`).
- **Test evidence:** existing `packages/x402-adapter/test/x402-adapter.test.ts:52-84` and new
  replay tests.

## 20. Nonce reuse / replay prevention

**Status: PARTIAL.**

- Implemented within a single facilitator: `NonceAlreadyConsumedError`
  (`packages/x402-adapter/src/index.ts:279-284`), reserve/check/commit (`:340-352,373-393`),
  verifier R9 replay flag (`packages/verifier-core/src/index.ts:292-303`), existing replay and
  concurrency tests (`packages/x402-adapter/test/x402-adapter.test.ts:52-104`).
- **What is missing:** the consumed set is per facilitator instance. A second facilitator (the
  natural model for another chain or another replica) has an independent store and accepts the
  identical signed nonce. This is not hypothetical: the existing test suite explicitly records it
  as exploited at the payment layer and detected only at the trace layer
  (`packages/attack-core/test/extended-attacks.test.ts:328-349`). The new file contains both a
  skipped desired-behaviour test and an active `GAP EVIDENCE` test reproducing it. See items 27/28.

## 21. Nonce behaviour when settlement fails

**Status: PARTIAL.**

- Local/HTTP adapters release the reservation on settlement failure, permitting a legitimate retry
  (`packages/x402-adapter/src/index.ts:383-392`); the new test drives `createHttpFacilitator` with
  a 500 response, asserts `isConsumed === false`, then a successful retry.
- **Limits:** the on-chain guard sets `consumed[nonce] = true` inside `validateAndConsume`
  (`contracts/src/PredicatePaymentGuard.sol:197-199`) with no release path, so a downstream failure
  after validation leaves the nonce spent. For `createHttpFacilitator`, "failure" is inferred from
  the HTTP status (`packages/x402-adapter/src/index.ts:421-433`); a timeout after the remote side
  settled would release locally and allow a retry. Atomicity is therefore only as strong as the
  settlement transport.

## 22. Atomicity / recovery semantics of nonce consumption vs payment execution

**Status: PARTIAL.**

- Implemented ordering: verify signature → reserve nonce → execute settlement → commit receipt,
  with release on throw (`packages/x402-adapter/src/index.ts:373-393`). The reserve is a synchronous
  check-and-set with no `await` between read and write (`:340-348`).
- The code documents its own limit explicitly: single-process event-loop atomicity only; a
  multi-replica deployment needs Redis `SETNX`, a unique index or a conditional UPDATE
  (`:319-333`).
- On-chain predicate validation and nonce consumption are in the same transaction
  (`contracts/src/PredicatePaymentGuard.sol:169-199`) — atomic for those two, but the actual token
  transfer is a separate leg not covered by that transaction.
- HTTP and on-chain facilitators reuse the client-side store (`:417-465`), so two replicas can each
  reserve the same nonce locally. **Test evidence:** the new concurrent-submission test passes for
  one facilitator instance only; the cross-instance case is the recorded GAP in items 20/27/28.

## 23. Adversarial replay tests

**Status: IMPLEMENTED.**

- Existing: same-facilitator replay and 24-way concurrency
  (`packages/x402-adapter/test/x402-adapter.test.ts:52-84`), concurrency harness
  (`src/concurrency.ts`, exercised at `:119-133`), MANDATE_REPLAY attack
  (`packages/attack-core/src/index.ts:315-337`; `test/attack-core.test.ts:37-39`), nonce-reuse
  scenario (`packages/attack-core/test/extended-attacks.test.ts:353-373`), on-chain guard replay
  revert (`packages/predicate-adapter/test/revert-mapping.test.ts:106-116`).
- New: replay rejection, 16-way concurrent single-winner, distinct-nonce independence, tampered
  authorization, failure-release/retry, and the cross-chain replay gap evidence.
- The cross-chain replay case is *documented as exploited* rather than hidden (item 28).

## 24. Authorization bound to intended chain

**Status: IMPLEMENTED.**

- `chainId` is a required positive integer in the identity, settlement, domain and payment schemas
  (`packages/schemas/src/index.ts:16,79,136`); it is in the CLB EIP-712 domain
  (`packages/clb-core/src/index.ts:76-83`) and in the payment EIP-712 domain and message
  (`packages/x402-adapter/src/index.ts:60,97-99,114`). Changing it changes the signed digest and
  therefore invalidates the signature.
- The on-chain guard's `DOMAIN_SEPARATOR` is immutable and includes the constructor chainId
  (`contracts/src/PredicatePaymentGuard.sol:58,77-86`).
- Mode A verifier R10 checks four chainId values against the domain chain
  (`packages/verifier-core/src/index.ts:327-336`).
- **Test evidence:** domain chainId vector and mutation test in the new file; existing
  `packages/clb-core/test/clb-core.test.ts:99-103`.

## 25. Actual execution-chain consistency enforcement

**Status: GAP.**

- Mode A is consistent: R10 compares `descriptor.chainId`, `settlement.chainId`,
  `payerAgent.chainId`, `identityRef.chainId` against `domain.chainId`
  (`packages/verifier-core/src/index.ts:327-336`).
- **Gap 1 (Mode B verifier):** the Mode B branch of `checkChainDomain`
  (`packages/verifier-core/src/index.ts:306-322`) checks only `settlement.chainId == concrete.chainId`,
  predicate allowance, and `payerAgent.chainId == identityRef.chainId`. It **never compares
  `bundle.clb.domain.chainId`** to any of them. Since Mode B has no human signature over `C'`,
  an off-chain trace can carry a mismatched domain chain and still pass R10.
- **Gap 2 (on-chain facilitator):** `createOnChainFacilitator` computes
  `const chainId = options.chainId ?? baseSepolia.id;` and then
  `const chain = chainId === baseSepolia.id ? baseSepolia : baseSepolia;`
  (`packages/x402-adapter/src/index.ts:448-450`) — the chain object is Base Sepolia for *every*
  configured chainId. `buildSettlementReceipt` copies `auth.chainId` into the receipt
  (`:305-317`), so the receipt can claim chain X while the transaction was submitted to Base
  Sepolia. No code compares the two.
- `CrossLayerBindingValidator` records no chain identifier at all
  (`contracts/src/CrossLayerBindingValidator.sol:10-38`), so the on-chain attestation cannot
  detect a chain transplant.
- No executable test was added for these two gaps: Gap 2 requires an RPC-backed facilitator and
  Gap 1 requires a full valid Mode B `TraceBundle`; both are documented here with exact lines
  rather than silently omitted.

## 26. Protocol / message domain separation

**Status: PARTIAL.**

- Implemented: distinct EIP-712 domain names (`CLB-ACEL` vs `CLB-ACEL-x402`,
  `packages/schemas/src/index.ts:134`; `packages/x402-adapter/src/index.ts:98`), distinct versions,
  distinct primary types (`CLBCommitment`, `CLBSettlementCommitment`, `PaymentAuthorization` —
  `packages/clb-core/src/index.ts:50,188`; `packages/x402-adapter/src/index.ts:105`), and a
  `settlementKind` tag in `simulateTxHash` (`:275-277`). Type hashes in §0.2.
- **What is missing / weaker:**
  1. Canonical-JSON hashes (`mandateDigest` `packages/clb-core/src/index.ts:66`, `settlementDigest`
     `:73`, certificate hash `packages/verifier-core/src/index.ts:458`, evidence hashes
     `packages/evidence-core/src/index.ts:65`) carry no domain or type tag. A collision would
     require two different objects with identical canonical JSON; schemas make that unlikely, but
     separation is by shape, not by construction.
  2. The optional `verifyingContract` (`packages/schemas/src/index.ts:137`,
     `packages/clb-core/src/index.ts:81`) switches viem to the 4-field domain type hash
     `0x8b73c3c6...`; the guard hardcodes the 3-field type hash `0xc2f87871...`
     (`contracts/src/PredicatePaymentGuard.sol:48-49,78-85`). `C'` computed with a
     `verifyingContract` will not match on-chain. This fails closed (guard rejects), but the parity
     claim in `packages/clb-core/src/index.ts:168-173` holds only for the 3-field domain.

## 27. Cross-chain reuse prevention

**Status: GAP.**

- Positive mechanisms exist: chainId in both EIP-712 domains (item 24), domain separation vectors
  in the new test, Mode A R10 (`packages/verifier-core/src/index.ts:327-336`), and the guard's
  immutable domain separator (`contracts/src/PredicatePaymentGuard.sol:58,77-86`).
- **Why this is still a GAP:** nonce consumption is local to a facilitator instance
  (`packages/x402-adapter/src/index.ts:335-363`), so an identical signed payload settles on a
  second chain/facilitator. The existing suite records exactly this in
  `packages/attack-core/test/extended-attacks.test.ts:328-349` ("This is a real cross-chain replay
  gap"), plus the Mode B verifier gap (item 25) and the on-chain facilitator's hardwired Base
  Sepolia (item 25). The new file's skipped `GAP 27/28` test states the desired shared-store
  behaviour and the active `GAP EVIDENCE 27/28` test demonstrates the current success of the
  replay.

## 28. Cross-chain replay and substitution tests

**Status: GAP (tests exist, but one of them demonstrates a real exploit).**

- Substitution/transplant tests that pass: `C` changes with domain chainId
  (`packages/clb-core/test/clb-core.test.ts:99-103` and new vectors), `CHAIN_TRANSPLANT` fails R10
  (`packages/verifier-core/test/verifier-core.test.ts:46`), identity substitution changes `C`
  (`packages/clb-core/test/clb-core.test.ts:105-111`).
- Replay tests that pass: same-facilitator nonce reuse is rejected
  (`packages/x402-adapter/test/x402-adapter.test.ts:52-84`; new file).
- **Gap-demonstrating test:** `packages/attack-core/test/extended-attacks.test.ts:328-350` settles
  the same payload through a second facilitator and classifies the outcome as `EXPLOITED` with
  only `DETECTION`/`ACCOUNTABILITY` at the trace layer. The new file reproduces this with
  `GAP EVIDENCE 27/28` and marks the desired behaviour `test.skip`. The requirement "cross-chain
  replay prevented" is therefore honestly reported as unmet, not dropped.

---

## Gap register (for the author response)

| # | Item | Severity | Finding | Evidence |
|---|---|---|---|---|
| G1 | 15 | Medium | No key revoke/rotate API; key mutation and status changes are not owner-authenticated; canonical registry read-only | `packages/erc8004-adapter/src/index.ts:100-131,189-204`; `src/types.ts:37-44` |
| G2 | 16 | Medium | `resource` not bound into the signed payment authorization | `packages/x402-adapter/src/index.ts:35,84-95,141,186`; `packages/clb-core/src/index.ts:70-74` |
| G3 | 20/27/28 | **High** | Cross-facilitator / cross-chain replay succeeds: nonce store is per instance | `packages/x402-adapter/src/index.ts:335-363,403-409`; `packages/attack-core/test/extended-attacks.test.ts:328-349` |
| G4 | 25 | **High** | Mode B R10 never checks `domain.chainId`; on-chain facilitator always uses Base Sepolia while receipt copies `auth.chainId` | `packages/verifier-core/src/index.ts:306-322`; `packages/x402-adapter/src/index.ts:305-317,448-450` |
| G5 | 21/22 | Medium | No release path on-chain; HTTP timeout can release locally after remote settlement; multi-replica reservation not atomic | `contracts/src/PredicatePaymentGuard.sol:197-199`; `packages/x402-adapter/src/index.ts:319-333,383-392,421-433` |
| G6 | 2/4/26 | Low | `canonicalJson` is not JCS, throws on bigint, no schema validation at hash boundaries, untagged hashes, optional `verifyingContract` breaks TS↔Solidity domain parity | `packages/evidence-core/src/index.ts:26-31,40-50`; `packages/clb-core/src/index.ts:81,104-106`; `contracts/src/PredicatePaymentGuard.sol:48-49,78-85` |

**Formal-model caveat:** `formal/tamarin/clb.spthy` proves P1–P5 under a Dolev-Yao attacker with a
*symbolic* hash (`builtins: hashing`, `h(...)`) and explicitly abstracts the design — it folds
`registryAddr` into the chain and uses allow-set membership for the predicate comparison
(`formal/tamarin/clb.spthy:20,25-31,37,64-83,96-133`). It is not evidence of keccak-level or
implementation-level correctness, and its P3 lemma ("each nonce consumed at most once")
(`clb.spthy:163-166`) does not cover the per-facilitator store limitation in G3.

**Reproduction commands** (from `E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2`, with
`$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"`):

```
bun test packages/clb-core/test/commitment-vectors.test.ts
bun run typecheck
```

Observed at time of writing: `35 pass, 2 skip, 0 fail` (91 expectations) and a clean `tsc --build`.
