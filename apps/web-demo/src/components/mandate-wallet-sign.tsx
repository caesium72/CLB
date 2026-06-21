"use client";

import { buildClbTypedData, computeMandateDigest } from "@clb-acel/clb-core";
import type { CLBCommitmentInput, Mandate } from "@clb-acel/schemas";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { type Address, type Hex, createWalletClient, custom, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useDemoRun } from "@/components/demo-run-provider";
import { chainForId, chainLabel, demoRpcUrl } from "@/lib/demo-chain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { friendlyDemoError } from "@/lib/demo-errors";

type PreparedHuman = {
  intent: { intentId: string };
  mandateDraft: Omit<Mandate, "signature" | "clbCommitment">;
  settlementDescriptor: CLBCommitmentInput["settlementDescriptor"];
  clb: Omit<CLBCommitmentInput, "mandateDigest">;
  clbDomain: CLBCommitmentInput["domain"];
  expectedCommitment: Hex;
};

const DEMO_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const demoAccount = privateKeyToAccount(DEMO_PRIVATE_KEY);
const ALREADY_PREPARED_MESSAGE = "A signer is already prepared for this mandate. Continue with signing, or create a new intent to switch accounts.";
const ALREADY_RUNNING_MESSAGE = "This payment is already being signed or settled. Wait for the current run to finish.";
const ALREADY_SETTLED_MESSAGE = "This payment already produced a live trace. Create a fresh intent and mandate to run another payment.";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

async function ensureWalletChain(chainId: number): Promise<void> {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 4902 || chainId !== 31337) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId,
          chainName: "Anvil Local",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [demoRpcUrl()],
        },
      ],
    });
  }
}

export function MandateWalletSign() {
  const router = useRouter();
  const { intentId, traceId, updateRun } = useDemoRun();
  const [address, setAddress] = useState<Address | null>(null);
  const [signerKind, setSignerKind] = useState<"wallet" | "demo" | null>(null);
  const [prepared, setPrepared] = useState<PreparedHuman | null>(null);
  const [signature, setSignature] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runInFlightRef = useRef(false);

  async function prepareForAddress(walletAddress: Address, kind: "wallet" | "demo") {
    const response = await fetch("/api/demo/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, mode: "a", humanPrincipal: walletAddress }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Prepare failed");
    setAddress(walletAddress);
    setSignerKind(kind);
    setPrepared(payload);
    updateRun({ runStatus: "ready", error: undefined });
  }

  async function connectAndPrepare() {
    setError(null);
    if (prepared || address) {
      setError(ALREADY_PREPARED_MESSAGE);
      return;
    }
    if (!intentId) {
      setError("Create an intent before signing a mandate.");
      return;
    }
    if (!window.ethereum) {
      setError("No browser wallet detected. Install MetaMask or Rabby and reload.");
      return;
    }

    setBusy(true);
    updateRun({ runStatus: "preparing", error: undefined });
    try {
      const requiredChainId = Number(process.env.NEXT_PUBLIC_DEMO_CHAIN_ID ?? 31337);
      await ensureWalletChain(requiredChainId);
      const client = createWalletClient({ chain: chainForId(requiredChainId), transport: custom(window.ethereum) });
      const [connected] = await client.requestAddresses();
      const walletAddress = getAddress(connected);
      await prepareForAddress(walletAddress, "wallet");
    } catch (cause) {
      const message = friendlyDemoError(cause, "Wallet preparation failed");
      setError(message);
      updateRun({ runStatus: "error", error: message });
    } finally {
      setBusy(false);
    }
  }

  async function prepareDemoAccount() {
    setError(null);
    if (prepared || address) {
      setError(ALREADY_PREPARED_MESSAGE);
      return;
    }
    if (!intentId) {
      setError("Create an intent before using the demo account.");
      return;
    }

    setBusy(true);
    updateRun({ runStatus: "preparing", error: undefined });
    try {
      await prepareForAddress(demoAccount.address, "demo");
    } catch (cause) {
      const message = friendlyDemoError(cause, "Demo account preparation failed");
      setError(message);
      updateRun({ runStatus: "error", error: message });
    } finally {
      setBusy(false);
    }
  }

  async function signAndRegister() {
    setError(null);
    if (traceId) {
      setError(ALREADY_SETTLED_MESSAGE);
      updateRun({ runStatus: "live-trace", error: undefined });
      return;
    }
    if (busy || runInFlightRef.current) {
      setError(ALREADY_RUNNING_MESSAGE);
      return;
    }
    if (!address || !prepared || (!window.ethereum && signerKind !== "demo")) {
      setError("Connect a wallet first.");
      return;
    }

    runInFlightRef.current = true;
    setBusy(true);
    updateRun({ runStatus: "signing", error: undefined });
    try {
      if (signerKind !== "demo") {
        await ensureWalletChain(prepared.clbDomain.chainId);
      }
      const mandateDraft = prepared.mandateDraft;
      if (getAddress(mandateDraft.humanPrincipal as Address) !== address) {
        throw new Error("Connected wallet does not match the prepared mandate signer.");
      }

      const clbInput = {
        ...prepared.clb,
        mandateDigest: computeMandateDigest(mandateDraft as Mandate),
      };
      const typedData = buildClbTypedData(clbInput);
      const walletSignature =
        signerKind === "demo"
          ? await demoAccount.signTypedData({
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
            })
          : await createWalletClient({
              account: address,
              chain: chainForId(prepared.clbDomain.chainId),
              transport: custom(window.ethereum!),
            }).signTypedData({
              account: address,
              domain: typedData.domain,
              types: typedData.types,
              primaryType: typedData.primaryType,
              message: typedData.message,
            });
      setSignature(walletSignature);

      const registerResponse = await fetch("/api/demo/mandates/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandateDraft,
          signature: walletSignature,
          clb: prepared.clb,
          expectedSigner: address,
        }),
      });
      const registered = await registerResponse.json();
      if (!registerResponse.ok) throw new Error(registered.error ?? "Mandate registration failed");
      updateRun({
        mandateId: registered.mandateId ?? registered.mandate?.mandateId ?? mandateDraft.mandateId,
        runStatus: "ready",
        checkoutStage: "idle",
      });
      router.push("/checkout");
    } catch (cause) {
      const message = friendlyDemoError(cause, "Signing failed");
      setError(message);
      updateRun({ runStatus: "error", error: message });
    } finally {
      runInFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Browser wallet signing</p>
          <p className="text-sm text-muted-foreground">
            Sign the exact cart authorization. The agent will pay on the next step.
          </p>
        </div>
        <Badge variant="outline">{signerKind === "demo" ? "Demo account" : "Live wallet"}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {prepared && address ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="font-medium">
              {signerKind === "demo" ? "Demo account prepared" : "Wallet prepared"}
            </span>
            <span className="ml-2 text-muted-foreground">Ready to sign this mandate.</span>
          </div>
        ) : (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void connectAndPrepare()}>
              Connect wallet
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void prepareDemoAccount()}>
              Use demo account
            </Button>
          </>
        )}
        <Button type="button" disabled={busy || !address || !prepared || Boolean(traceId)} onClick={() => void signAndRegister()}>
          {traceId ? "Already authorized" : busy ? "Signing…" : "Sign cart authorization"}
        </Button>
      </div>
      {signerKind !== "wallet" ? (
        <p className="text-xs text-muted-foreground">
          The demo account is a local walkthrough signer, not a production wallet or custody pattern.
        </p>
      ) : null}

      {prepared ? (
        <div className="space-y-2 text-sm">
          <p>
            Required network: <span className="font-medium">{chainLabel(prepared.clbDomain.chainId)}</span>{" "}
            <span className="font-mono">({prepared.clbDomain.chainId})</span>
          </p>
          <p className="font-mono text-xs break-all">
            <span className="text-muted-foreground">Mandate: </span>
            {prepared.mandateDraft.mandateId}
          </p>
          <p className="font-mono text-xs break-all">
            <span className="text-muted-foreground">Commitment C: </span>
            {prepared.expectedCommitment}
          </p>
        </div>
      ) : null}

      {address ? (
        <p className="font-mono text-xs break-all">
          <span className="text-muted-foreground">Connected: </span>
          {address}
        </p>
      ) : null}
      {signature ? (
        <p className="font-mono text-xs break-all">
          <span className="text-muted-foreground">Signature: </span>
          {signature}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
