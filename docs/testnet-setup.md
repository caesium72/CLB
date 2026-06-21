# Base Sepolia testnet setup (Phase 7B)

All testnet assets have **zero real-world monetary value**. The ETH is for gas. The USDC is a test token issued by Circle for development. **Never use wallets that hold real funds** — generate dedicated testnet-only keys.

**Recommended demo path:** [Option A — your agents, your wallets](./option-a-demo-setup.md) (quick A1 or full on-chain A2).

## 1. Generate wallets

Generate three dedicated testnet wallets (deployer, shopping agent, merchant agent):

```bash
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts'); for(let i=0;i<3;i++){const k=generatePrivateKey(); console.log(k, privateKeyToAccount(k).address)}"
```

Or with Foundry:

```bash
cast wallet new
```

Map the keys to:

| Env var | Role |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Deploys contracts; anchors Merkle roots |
| `SHOPPING_AGENT_PRIVATE_KEY` | Pays x402 settlements (needs ETH + USDC) |
| `MERCHANT_AGENT_PRIVATE_KEY` | Receives USDC; signs delivery reports |

`USER_TEST_PRIVATE_KEY` can reuse the deployer key for mandate demos.

## 2. Fund with testnet ETH (gas)

Fund **deployer** and **shopping agent** addresses from a free faucet:

- [Coinbase CDP faucet](https://portal.cdp.coinbase.com/products/faucet) — Base Sepolia, free account (recommended)
- [Chainlink faucet](https://faucets.chain.link/base-sepolia) — 0.5 ETH per claim
- [thirdweb faucet](https://thirdweb.com/base-sepolia-testnet) — no mainnet balance required
- [Alchemy Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia) — requires **≥ 0.001 ETH on Ethereum mainnet** (new wallets often fail)

The merchant wallet does **not** need ETH — it is the EIP-3009 transfer recipient and does not pay gas.

## 3. Fund shopping agent with testnet USDC

1. Go to [Circle testnet faucet](https://faucet.circle.com)
2. Select **Base** → **Sepolia**
3. Enter the shopping agent address
4. Click **Send USDC** (~10 testnet USDC per request)

Official Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` ([Circle docs](https://developers.circle.com/stablecoins/docs/usdc-on-test-networks)).

## 4. Register agents on ERC-8004

If an official ERC-8004 Identity Registry is deployed on Base Sepolia, register both agents there and note `ERC8004_REGISTRY_ADDRESS` and each `agentId`.

Otherwise deploy the repo mock registry to Base Sepolia and register your demo agents — full steps in [option-a-demo-setup.md](./option-a-demo-setup.md#a2--full-demo-on-chain-registry):

```bash
./scripts/deploy-base-sepolia.sh
# add AUDIT_ANCHOR_ADDRESS + ERC8004_REGISTRY_ADDRESS to .env
./scripts/start-all-services.sh          # terminal 1
bun run setup:register-agents            # terminal 2
```

## 5. Configure `.env`

Copy from `.env.example` and fill the Base Sepolia block:

```bash
CHAIN_ID=84532
RPC_URL_BASE_SEPOLIA=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...
USER_TEST_PRIVATE_KEY=0x...
SHOPPING_AGENT_PRIVATE_KEY=0x...
MERCHANT_AGENT_PRIVATE_KEY=0x...

ERC8004_REGISTRY_ADDRESS=0x...
TEST_AGENT_ID=shopping-agent-001

X402_FACILITATOR_MODE=chain
X402_NETWORK=base-sepolia
X402_ASSET=USDC
X402_ASSET_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
X402_PAY_TO_ADDRESS=0x...   # merchant wallet
X402_PRICE=2.00

AUDIT_ANCHOR_ADDRESS=0x...  # optional; auto-anchor is a no-op when unset
```

## 6. Smoke test

With funded wallets and env configured:

```bash
bun run e2e:phase2
```

Expected: `settlement.txHash` is a real Base Sepolia transaction. Paste it into [sepolia.basescan.org](https://sepolia.basescan.org) to confirm the USDC transfer to `X402_PAY_TO_ADDRESS`.

For offline/CI, leave `X402_FACILITATOR_MODE=local` and omit RPC/registry env vars — the mock adapters keep tests green.
