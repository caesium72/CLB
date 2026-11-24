# Reviewer Revision Status

This working copy (`A3C-v2`) is being revised against the A³C-VPEAL reviewer comments. See `review-revision/REVISION_TRACKER.md` for per-comment status and `review-revision/BASELINE_AUDIT.md` for the source audit.

## Current work

- Reviewer #2, Comment 1: **resolved in the repository** on technical grounds. Code, tests and executed evidence are complete and reproducible. No manuscript edit is required for this comment; the prepared `manuscript-insert.tex` is optional reference material only.
- Reviewer #2, Comment 2: resolved on Base Sepolia (11 mined txs, 11/11 as expected, PUBLIC_NETWORK_EVIDENCE=true; funded via PoW + canonical bridge).
- Reviewer #3: C1, C2, C4, C5 RESOLVED; C3 not started. C2 closes all HIGH gaps (bound settlement gate + authenticated registration + confidential/formal fixes); MEDIUM residuals explicitly documented as trust assumptions.
- Reviewer #4: not started.

## Execution environment (resolved)

Bun 1.4.5 is installed and workspace dependencies are installed. All commands in `review-revision/reviewer-2/comment-1/reproduction-commands.md` now run:

- `bun run typecheck` — clean
- `bun test packages/attack-core` — 7 pass
- `bun test packages/x402-adapter` — 7 pass
- `bun run e2e:reviewer2:comment1` — 465 matrix scenarios (100% detected), 9/9 prevented, 3,720 concurrent attempts (0 anomalies)

Three tests in `apps/merchant-agent-api` and `services/identity-service` fail on this machine for environment reasons (env-supplied price and agent id); their sources are unchanged from `A3C-V1`.

The original uploaded ZIP is not modified. This directory is a separate working copy.
- Reviewer #4: C2, C3, C4 resolved (technical); C1 not started.
