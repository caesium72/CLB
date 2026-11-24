# Baseline Audit

## Source archives

- Manuscript archive: `ICCIT-A3C-VPEAL-(Rabbi,Jaif,Alamin).zip`
- Repository archive: `agentic-web3-project-v3.zip`

## Manuscript entry point

`main.tex` is treated as the primary candidate because it is the root manuscript source in the archive. `main-v0.tex` through `main-v3.tex` are preserved as historical variants. The actual submitted version should be confirmed against the submission record before finalizing revisions.

## Existing repository capabilities relevant to the reviewers

- Ten deterministic Mode A attack fixtures in `packages/attack-core/src/index.ts`.
- Five Mode B predicate fixtures in `packages/attack-core/src/mode-b.ts` (one happy path and four violations).
- Four baseline labels B0–B3 and executable baseline evaluators.
- Tamarin and ProVerif source artifacts under `formal/`.
- Foundry tests for `PredicatePaymentGuard`.
- Local Anvil deployment scripts and Base Sepolia deployment scripts.
- An on-chain facilitator implementation in `packages/x402-adapter/src/index.ts` that explicitly sends a zero-value transaction with a hash payload; this is not a token transfer.
- `PredicatePaymentGuard` and `predicate-adapter` explicitly describe themselves as a demo substitute, not a production ERC-7710 wallet-delegation implementation.

## Execution environment limitations

- Node.js and TypeScript compiler are available.
- Bun is not installed.
- Workspace dependencies (`node_modules`) are absent.
- Network access to npm is unavailable in this environment (`EAI_AGAIN` resolving registry.npmjs.org).
- Consequently, the repository's Bun test suites and workspace typecheck cannot currently be executed here.
- No public-chain deployment has been attempted.

## Initial findings

1. The local in-memory facilitator checks whether a nonce is consumed, then awaits settlement, then marks it consumed. Concurrent requests with the same nonce can both pass the initial check. An in-flight reservation has been added.
2. Existing Mode A fixtures are single deterministic mutations.
3. Existing Mode B fixtures include a valid case and four predicate violations. The fixture builder creates a local settlement receipt before `runPredicateAttack` asks the guard whether the predicate would allow the transaction. Thus, the current benchmark's `guardPrevented` label is not by itself proof that a transfer was prevented before settlement. This must be corrected before relying on those claims.
4. The evidence verifier's R1 checks hash-chain and Merkle-root integrity, but the verifier does not independently establish completeness of the event set. This is a separate trust-model issue for Reviewer #4.
