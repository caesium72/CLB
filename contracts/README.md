# CLB-ACEL Contracts (Foundry)

On-chain components for ACEL. Only roots/hashes are stored on-chain; full
evidence stays off-chain (Postgres/S3).

| Contract                        | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `AgenticAuditAnchor.sol`        | Anchors one `(merkleRoot, traceHash, metadataURI)` per `traceId`.    |
| `MockERC8004IdentityRegistry.sol` | v1 stand-in ERC-8004 identity registry (agentId/owner/keys/status). |

## Prerequisites

Foundry is **not** bundled with this repo. Install it first:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge install foundry-rs/forge-std   # run inside contracts/
```

## Build & test

```bash
cd contracts
forge install foundry-rs/forge-std   # first time only
forge build
forge test -vvv
```

CI runs the same `forge test` flow in `.github/workflows/ci.yml`.

## Deploy

```bash
# Local Anvil (docker compose up -d anvil)
forge script script/Deploy.s.sol --rpc-url anvil --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Base Sepolia (set RPC_URL_BASE_SEPOLIA in repo .env)
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

After deploying, set `AUDIT_ANCHOR_ADDRESS` and `ERC8004_REGISTRY_ADDRESS` in
`.env`. The `@clb-acel/erc8004-adapter` and evidence-service anchor flow can then
be repointed from the in-memory/local implementations to these addresses.
