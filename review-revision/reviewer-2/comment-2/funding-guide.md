# Funding the Base Sepolia signer — exact steps

## UPDATE — funding completed, public run executed

The signer is funded and `bun run e2e:reviewer2:comment2:public` has run for real:
guard `0xB1c8273F74365c146c9b8b233b7286a441ac2652`, 11 mined txs, 11/11 as
expected, `PUBLIC_NETWORK_EVIDENCE: true`. Steps below are kept as the record of
how the testnet ETH was obtained.
**Status (historical):** the public harness is implemented and ready (`bun run e2e:reviewer2:comment2:public`). The only blocker is test ETH for the signer.

```
Signer address:     0x8eEd4275420870c43C06f370Af3AD53FFdB3B005
Current balance:    0 ETH on Base Sepolia  (checked 2026-11-24)
RPC:                https://sepolia.base.org  (chain 84532)
```

Everything below is **human-in-the-loop** (browser / captcha / wallet signature). I cannot perform these steps from the terminal.

## Path A — PoW mine Sepolia ETH, then bridge to Base Sepolia (no account, no mainnet funds)

This is the only path that requires neither a paid plan nor an existing exchange/Coinbase account.

### Step 1 — Mine free Sepolia ETH (no signup)

1. Open https://sepolia-faucet.pk910.de/
2. Paste the signer address: `0x8eEd4275420870c43C06f370Af3AD53FFdB3B005`
3. Start mining — the page does CPU proof-of-work in the browser. Leave it running until you have at least **0.002 ETH** (deployment + ~11 transactions needs far less; 0.002 is a safe margin).
4. Stop and claim. The faucet sends Ethereum **Sepolia** ETH (chain 11155111) to the same address.

### Step 2 — Connect MetaMask to Sepolia

1. MetaMask → Import Account → paste the throwaway private key from `A3C-v2/.env` (`DEPLOYER_PRIVATE_KEY`). This is a testnet burner key with 0 real value — safe.
2. Add network **Sepolia** (chain 11155111) if not present.
3. You should now see the mined Sepolia ETH at the same address.

### Step 3 — Bridge Sepolia ETH → Base Sepolia

1. Open the official testnet bridge from Base docs:
   https://superbridge.app/?fromChainId=11155111&toChainId=84532
2. Connect MetaMask.
3. From: Sepolia → To: Base Sepolia (chain 84532).
4. Bridge a small amount (e.g. 0.001 ETH). Standard-bridge deposits from L1 to L2 do **not** have the 5-day finalization window (that applies only to withdrawals).
5. Confirm in MetaMask; wait for the destination balance to appear.

Alternative testnet bridge (also listed in Base docs): https://testnet.brid.gg/?fromChainId=11155111&toChainId=84532

### Step 3b — OR bridge programmatically (no MetaMask UI)

If the Sepolia ETH was mined to the same signer, the bridge can be sent from the CLI:

```powershell
bun run bridge:sepolia-to-base
```

It uses the canonical `L1StandardBridge` on Sepolia
(`0xfd0Bf71F60660E2f608ed56e1659C450eB113120`, from viem's `baseSepolia` chain config),
bridges `BRIDGE_AMOUNT_ETH` (default 0.001), waits for the L2 balance and prints both
explorer links. It refuses to run if the Sepolia balance can't cover the bridge plus gas.

### Step 4 — Verify the funding

```powershell
$body='{"jsonrpc":"2.0","method":"eth_getBalance","params":["0x8eEd4275420870c43C06f370Af3AD53FFdB3B005","latest"],"id":1}'
$r=Invoke-RestMethod -Uri 'https://sepolia.base.org' -Method Post -ContentType 'application/json' -Body $body
$wei=[System.Numerics.BigInteger]::Parse($r.result.Substring(2),[System.Globalization.NumberStyles]::HexNumber)
"balance_eth=$([math]::Round([double]$wei/1e18,8))"
```

### Step 5 — Run the public evaluation

```powershell
$env:Path="$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.foundry\bin;$env:Path"
cd "E:\RESEARCH\A3C-VPEAL [ICCIT-26]\A3C-v2"
bun run e2e:reviewer2:comment2:public
```

Expected: guard deployment (or reuse), predicate registration, 11 real txs including mined reverts, and artifacts at
`experiments/benchmarks/reviewer2/comment2/public/onchain-guard-results.public.json` with:

```
PUBLIC_NETWORK_EVIDENCE: true
network: base-sepolia · chainId: 84532
txHash / blockNumber / gasUsed / explorerUrl per plan
```

## Path B — fund directly with an existing account

If you already have a Coinbase account or any exchange with Base Sepolia test ETH, withdraw/claim directly to the signer address above, then go to Step 4.

Faucets that might work with a free account (no payment):
- Coinbase CDP: https://portal.cdp.coinbase.com/onchain-tools/faucet (up to 0.1 ETH/24h)
- Alchemy: https://www.alchemy.com/faucets/base-sepolia (free account, but requires mainnet holdings)
- Circle test USDC (not ETH): https://faucet.circle.com

Fauctets already ruled out: thirdweb (paid plan), QuickNode (mainnet balance required), Chainstack (API key + mainnet rules), ethfaucet.com (BringID rejected this address).

## Honest limits

- I cannot mine, pass captchas, connect MetaMask, or claim from a faucet — those require a human at a browser.
- I cannot fabricate a funded balance or public tx hashes. Until Path A/B completes, the artifact stays `NOT RUN` / `PUBLIC_NETWORK_EVIDENCE: false`.
- If you'd rather not do this, R2-C2 remains honestly partial: local Anvil EVM evidence exists, public-network evidence does not.

## After the run

Paste me the output (or just say "done") and I will:
1. verify the artifact flags and each BaseScan tx link,
2. run `reproduce:all` + full suite once more,
3. update the tracker from PARTIAL → RESOLVED if all 11 plans behaved as expected.

