# IRCV — serialization consistency

Method: clb-core functions vs independent TypeScript mirror of Solidity ABI/EIP-712 formulas (no Solidity execution in this component)

| Check | Field | Result |
| --- | --- | --- |
| default-config | predicateConfigDigest | MATCH |
| default-extras | predicateExtrasDigest | MATCH |
| default-predicate | predicateDigest(config,extras) | MATCH |
| default-params | settlementParamsDigest | MATCH |
| default-cprime | C' (EIP-712 struct hash) | MATCH |
| default-nonce | nonce = H(C') | MATCH |
| default-binding | predicateGuardBindingDigest (EIP-191) | MATCH |
| multi-field-config | predicateConfigDigest | MATCH |
| multi-field-extras | predicateExtrasDigest | MATCH |
| multi-field-predicate | predicateDigest(config,extras) | MATCH |
| multi-field-params | settlementParamsDigest | MATCH |
| multi-field-cprime | C' (EIP-712 struct hash) | MATCH |
| multi-field-nonce | nonce = H(C') | MATCH |
| multi-field-binding | predicateGuardBindingDigest (EIP-191) | MATCH |
| rclb-ct | C_t = keccak256(abi.encode(C,E_I,E_M,T,N)) | MATCH |
| rclb-nonce | revocation-aware payment nonce | MATCH |
| negative-control-config | maxValue change must change configDigest | MATCH |

17 checks: 17 matched, 0 mismatched.

## Findings (reported, not fixed)

- **FINDING-MULTI-PAYEE-GETADDRESS** (medium): computePredicateConfigDigest throws for >=2 allowedPayees: InvalidAddressError (viem getAddress receives the map index as chainId). Core source was NOT modified; this framework reports only.
