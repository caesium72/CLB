# Deploy: Lightsail (Anvil + backend) + Vercel (frontend)

| Layer | Where |
| ----- | ----- |
| Chain | Lightsail — Anvil `31337` |
| Backends | Lightsail — ports 4000–4006 |
| Frontend | Vercel — `apps/web-demo` |

**Lightsail files** (`deploy/lightsail/`):

| File | Purpose |
| ---- | ------- |
| `install.sh` | Bun, Foundry, uv, nginx |
| `env.production.example` | Server `.env` template |
| `clb-acel-anvil.service` | Anvil on `0.0.0.0:8545` |
| `clb-acel-backend.service` | Seven Fastify services |
| `setup-https.sh` | nip.io + Let's Encrypt + nginx |
| `nginx.conf` | HTTPS routes (used by setup script) |
| `vercel.env.example` | Vercel environment variables |

---

## 1. Clone + install (Lightsail)

SSH as `ubuntu@18.142.200.48` (or your static IP). Repo path: `/home/ubuntu/agentic-web3`.

### Private GitHub clone (`clb-acel` branch)

Create a [classic PAT](https://github.com/settings/tokens) with **repo** scope. On the server:

```bash
cd ~
git clone -b clb-acel https://github.com/alaminXpro/agentic-web3.git
cd agentic-web3
```

When prompted:

- **Username:** your GitHub username (e.g. `alaminXpro`)
- **Password:** the classic token (`ghp_...`), not your GitHub password

One-line (token in URL — avoid on shared screens; clear shell history after):

```bash
git clone -b clb-acel "https://<GITHUB_USER>:<CLASSIC_TOKEN>@github.com/alaminXpro/agentic-web3.git"
```

### Install dependencies

```bash
cd ~/agentic-web3
bash deploy/lightsail/install.sh
nano .env   # from deploy/lightsail/env.production.example — set DATABASE_URL, S3, etc.
```

Firewall (demo): **22, 80, 443, 8545** (and **4000–4006** only if skipping HTTPS).

---

## 2. Anvil + contracts + backend

```bash
cd ~/agentic-web3
sudo cp deploy/lightsail/clb-acel-{anvil,backend}.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clb-acel-anvil
bash scripts/deploy-anvil-contracts.sh   # paste addresses into .env
sudo systemctl enable --now clb-acel-backend
curl -s http://127.0.0.1:4000/health
```

Server `.env`: keep service URLs on `http://127.0.0.1:400x`, `ORCHESTRATOR_TRANSPORT=http`, `RPC_URL=http://127.0.0.1:8545`.

---

## 3. HTTPS (static IP via nip.io)

Let's Encrypt does not certify bare IPs. Use **`<ip>.nip.io`** (e.g. `18.142.200.48.nip.io`):

```bash
sudo bash deploy/lightsail/setup-https.sh
curl -s https://18.142.200.48.nip.io/orchestrator/health
```

- Anvil HTTPS: `https://18.142.200.48.nip.io/rpc`
- Anvil HTTP: `http://18.142.200.48:8545`

---

## 4. Vercel

1. Root directory: `apps/web-demo`
2. Copy `deploy/lightsail/vercel.env.example` into Vercel env
3. Redeploy

Anchor and RPC stay on Lightsail — do not put `DEPLOYER_PRIVATE_KEY` / `RPC_URL` on Vercel.

**Signing:** Demo account (default) or MetaMask with `NEXT_PUBLIC_RPC_URL` above.

---

## 5. Verify

```bash
# On server
bun run e2e:phase5
```

Then walk through [demo-walkthrough.md](./demo-walkthrough.md) on the Vercel URL.

---

## Updates

```bash
cd ~/agentic-web3 && git pull && bun install
bash scripts/deploy-anvil-contracts.sh   # if Anvil restarted
sudo systemctl restart clb-acel-backend
```

---

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Vercel `502` | `curl https://18.142.200.48.nip.io/orchestrator/health` |
| certbot fails | `dig +short 18.142.200.48.nip.io` must return your IP |
| Empty evidence | `DATABASE_URL`, evidence-service logs |
| Anvil reset | Re-run `deploy-anvil-contracts.sh`, update `.env` |
