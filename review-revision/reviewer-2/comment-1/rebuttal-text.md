# Reviewer #2 – Comment 1: Response text

## Comment

> The evaluation is based on a relatively small and deterministic set of modelled attack scenarios. The reviewer requests broader adversarial evaluation covering more complex multi-step attacks, malicious merchants, compromised agents, and concurrent transactions.

## Response

We agree that a fixed list of modelled scenarios does not establish that the
guarantees generalise, and we have replaced that list with a compositional attack
space rather than adding further hand-written cases.

We decomposed the threat model into nine independent attack primitives across
merchant, agent, settlement, delivery and evidence surfaces, and execute each one
alone, in every ordered pair, and in twelve curated three-step chains, under five
seeds that vary amount, asset, attacker payee, task hash and token. Across 465
executed scenarios every attack was detected and the rule targeting the injected
primitive always failed, giving 45/45 for singles, 360/360 for pairs and 60/60 for
chains.

The two roles the reviewer names are covered directly. For malicious merchants we
execute payee substitution, merchant-identity revocation and delivery forgery,
alone and combined with a manipulated discovery step. For compromised agents we
assume control of the agent's orchestration logic but explicitly not its signing
key, and execute amount escalation, asset switching, chain switching, task
substitution and payment-key de-authorization. All are rejected.

We also separate detection from prevention. In the delegated flow the predicate
guard is now evaluated before the facilitator is called and settlement proceeds
only if the guard allows it. Across nine scenarios the guard denied eight and the
facilitator rejected the ninth on an already-consumed nonce; no settlement
receipt was issued for any attacked attempt, which is direct evidence that no
value moved.

For concurrency we found and fixed a genuine race: two requests could both pass
the consumed-nonce check before either wrote. The nonce is now reserved in an
in-flight set between signature verification and settlement. We evaluate the
reservation at concurrency levels 2, 4, 8, 16 and 32, twenty trials per level, in
three shapes (identical nonces, distinct nonces, mixed). Across 3,720 concurrent
attempts no nonce settled twice, every distinct-nonce burst settled completely,
and no anomaly occurred.

We state three limits explicitly in the revised text: the matrix measures
detection and prevention is established only where a pre-settlement guard exists;
the nonce reservation is per-process, so a multi-replica facilitator would need a
shared nonce store, which we have not evaluated; and the primitives are modelled
from the protocol surface rather than discovered by fuzzing, so the matrix bounds
the attacks we enumerated, not all attacks.

The harness, the guard ordering and the in-flight reservation are part of the
released artifact, and `bun run e2e:reviewer2:comment1` regenerates every table
in the revision.

## Where to look

- §Broader Adversarial Evaluation (new subsection, three tables)
- `packages/attack-core/src/adversarial-matrix.ts`
- `packages/attack-core/src/presettlement.ts`
- `packages/x402-adapter/src/concurrency.ts`
- `experiments/benchmarks/reviewer2/comment1/SUMMARY.md`
