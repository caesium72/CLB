# Paste-ready RCLB text

The text below is scoped to what this repository implements and measures. It
makes **no** claim of literature priority and contains **no** citations; add
your own qualification references if the surrounding manuscript requires them.

## Method paragraph

```text
We add a revocation-aware temporal binding RCLB around the existing cross-layer
commitment. Let C denote the CLB commitment (C in the exact mode, C' in the
delegated mode), E_I the identity-authorization epoch, E_M the mandate-revocation
epoch, T_expiry an inclusive Unix-seconds deadline, and N a single-use
application nonce. The settlement-time commitment is
C_t = keccak256(abi.encode(bytes32 C, uint256 E_I, uint256 E_M, uint64 T_expiry,
bytes32 N)), with payment nonce keccak256(C_t). Settlement is accepted only if
E_I and E_M equal the authority state read at execution time, the settlement
time is at most T_expiry, and N has not been consumed. A failed authority read
fails closed. The same construction is implemented in the TypeScript core and in
a Solidity guard, with byte-identical golden vectors. Epoch checks precede nonce
consumption, so a revocation that lands between a pre-check and settlement
reverts atomically without burning the nonce.
```

## Evaluation paragraph

```text
We evaluated RCLB with eight deterministic scenarios covering settlement after
identity revocation, settlement after mandate revocation, identity-key rotation,
a stale registry snapshot, a revocation-versus-settlement race, a delayed message
past T_expiry, application-nonce replay, and an honest control. All seven
adversarial scenarios were rejected and the honest control was accepted, giving
a stale acceptance rate of 0/1, a false rejection rate of 0/1, and race
resistance of 1/1. In-process revocation plus one acceptance decision took
0.046 ms at the median over 200 samples (mean 0.067 ms, 95th percentile 0.089 ms);
this excludes network, RPC and finality time. On a local EVM demo harness, the
guard used 59,834 gas versus 5,769 for a same-shape accept without authority
epoch reads and expiry enforcement, an overhead of 54,065 gas that also includes
cold account access, ABI decoding and the settlement event. These are local
implementation measurements, not testnet or production figures.
```

## Limitations sentence

```text
The evaluation uses a single authority, discrete epoch counters and scripted
scenarios rather than an operational workload; the gas figure is from a local
EVM demo and no claim of literature novelty or priority is made.
```

## Where to find evidence

- Construction and acceptance: `packages/clb-core/src/epochs.ts`
- On-chain parity and race ordering: `contracts/src/RevocationAwareGuard.sol`
- Verifier integration: `packages/verifier-core/src/index.ts` (R18 region)
- Raw numbers: `experiments/novelty/rclb/metrics.json`
