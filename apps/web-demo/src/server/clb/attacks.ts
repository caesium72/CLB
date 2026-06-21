/**
 * In-process Attack Lab. Drives the attack-core fixtures directly so the Attack
 * Lab works on Vercel without the Fastify attack-simulator (:4006). attack-core is
 * fully offline and deterministic (no env, registry, or RPC), so runs are
 * reproducible — a fixed seed makes "Run attack" identical every time.
 */
import {
  listAttacks,
  listPredicateAttacks,
  runAttack,
  runPredicateAttack,
} from "@clb-acel/attack-core";

export { listAttacks, listPredicateAttacks, runAttack, runPredicateAttack };

/** Fixed seed → reproducible scenarios (plan: reproducible, not mock). */
export const ATTACK_SEED = 1_717_200_000_000;

export type AttackIdParam = Parameters<typeof runAttack>[0];
export type PredicateAttackIdParam = Parameters<typeof runPredicateAttack>[0];
