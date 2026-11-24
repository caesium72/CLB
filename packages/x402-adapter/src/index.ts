import { canonicalJson } from "@clb-acel/evidence-core";
import type { SettlementDescriptorExact, SpendingPredicate } from "@clb-acel/schemas";
import type {
  GuardResult,
  GuardSettlementInput,
  PredicateGuardAdapter,
} from "@clb-acel/predicate-adapter";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export const X402_VERSION = 1;

/** x402 payment scheme: `exact` (Mode A) or `predicate` (Mode B, delegated). */
export type PaymentScheme = "exact" | "predicate";

/** One acceptable payment option in an x402 `402` response. */
export type PaymentRequirements = {
  scheme: PaymentScheme;
  network: string;
  asset: string;
  payTo: Address;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  validBefore: string;
  chainId: number;
  /** Stable predicate id referenced by `predicate`-scheme requirements (Mode B). */
  predicateId?: string;
};

export type PaymentRequirementsResponse = {
  x402Version: number;
  accepts: PaymentRequirements[];
  error?: string;
};

/** EIP-3009-style transfer authorization, with the CLB-derived nonce. */
export type PaymentAuthorization = {
  from: Address;
  to: Address;
  value: string;
  asset: string;
  validBefore: string;
  nonce: Hex;
  network: string;
  chainId: number;
};

export type PaymentPayload = {
  x402Version: number;
  scheme: PaymentScheme;
  network: string;
  authorization: PaymentAuthorization;
  signature: Hex;
};

export type SettlementReceipt = {
  settled: boolean;
  txHash: Hex;
  payer: Address;
  payTo: Address;
  value: string;
  asset: string;
  network: string;
  chainId: number;
  nonce: Hex;
  settledAt: string;
};

export const PAYMENT_AUTH_TYPES = {
  PaymentAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "string" },
    { name: "asset", type: "string" },
    { name: "validBefore", type: "string" },
    { name: "nonce", type: "bytes32" },
    { name: "network", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

function authDomain(chainId: number) {
  return { name: "CLB-ACEL-x402", version: "0.1", chainId } as const;
}

function authTypedData(auth: PaymentAuthorization) {
  return {
    domain: authDomain(auth.chainId),
    types: PAYMENT_AUTH_TYPES,
    primaryType: "PaymentAuthorization" as const,
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: auth.value,
      asset: auth.asset,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
      network: auth.network,
      chainId: BigInt(auth.chainId),
    },
  } as const;
}

export type BuildRequirementsInput = {
  descriptor: SettlementDescriptorExact;
  resource: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
};

/** Build the body of a `402 Payment Required` response from a settlement descriptor. */
export function buildPaymentRequirements(
  input: BuildRequirementsInput,
): PaymentRequirementsResponse {
  const { descriptor } = input;
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: descriptor.x402Scheme,
        network: descriptor.network,
        asset: descriptor.asset,
        payTo: getAddress(descriptor.payTo),
        maxAmountRequired: descriptor.value,
        resource: input.resource,
        description: input.description ?? "Token risk report",
        mimeType: input.mimeType ?? "application/json",
        maxTimeoutSeconds: input.maxTimeoutSeconds ?? 120,
        validBefore: descriptor.validBefore,
        chainId: descriptor.chainId,
      },
    ],
  };
}

export type BuildPredicateRequirementsInput = {
  predicate: SpendingPredicate;
  predicateId: string;
  resource: string;
  /** Concrete params if the agent has already chosen them within the predicate. */
  concreteSettlement?: SettlementDescriptorExact;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Build a `402 Payment Required` response for the delegated (Mode B) flow. The
 * response references the predicate id and `predicate` scheme; concrete fields
 * fall back to predicate bounds when the agent has not yet chosen them.
 */
export function buildPredicatePaymentRequirements(
  input: BuildPredicateRequirementsInput,
): PaymentRequirementsResponse {
  const { predicate, concreteSettlement } = input;
  const payTo = concreteSettlement?.payTo ?? predicate.allowedPayees[0] ?? ZERO_ADDRESS;
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: "predicate",
        network: concreteSettlement?.network ?? "",
        asset: concreteSettlement?.asset ?? predicate.allowedAssets[0] ?? "",
        payTo: getAddress(payTo),
        maxAmountRequired: concreteSettlement?.value ?? predicate.maxValue,
        resource: input.resource,
        description: input.description ?? "Token risk report (predicate-authorized)",
        mimeType: input.mimeType ?? "application/json",
        maxTimeoutSeconds: input.maxTimeoutSeconds ?? 120,
        validBefore: concreteSettlement?.validBefore ?? predicate.validUntil,
        chainId: concreteSettlement?.chainId ?? predicate.allowedChainIds[0] ?? 0,
        predicateId: input.predicateId,
      },
    ],
  };
}

export type SettlePredicateInput = {
  payload: PaymentPayload;
  /** Predicate guard adapter (in-memory or contract). */
  guard: PredicateGuardAdapter;
  /** Predicate + concrete params + C' inputs the guard evaluates. */
  guardInput: GuardSettlementInput;
  /** Settlement facilitator; defaults to the deterministic local facilitator. */
  facilitator?: Facilitator;
};

export type SettlePredicateResult = {
  receipt: SettlementReceipt;
  guardResult: GuardResult;
};

/**
 * Settle a `predicate`-scheme payment: evaluate the predicate and verify the
 * C'/nonce binding via the guard (throws on violation), then consume the nonce
 * exactly once through the facilitator. Mirrors the on-chain
 * `PredicatePaymentGuard.validateAndConsume` + settlement ordering.
 */
export async function settlePredicate(input: SettlePredicateInput): Promise<SettlePredicateResult> {
  const guardResult = await input.guard.assertSettlementAllowed(input.guardInput);
  const facilitator = input.facilitator ?? createLocalFacilitator();
  const receipt = await facilitator.settle(input.payload);
  return { receipt, guardResult };
}

/** Construct the payment authorization for a descriptor, pinning the CLB nonce. */
export function buildPaymentAuthorization(input: {
  from: Address;
  descriptor: SettlementDescriptorExact;
  nonce: Hex;
}): PaymentAuthorization {
  return {
    from: getAddress(input.from),
    to: getAddress(input.descriptor.payTo),
    value: input.descriptor.value,
    asset: input.descriptor.asset,
    validBefore: input.descriptor.validBefore,
    nonce: input.nonce,
    network: input.descriptor.network,
    chainId: input.descriptor.chainId,
  };
}

/** Sign a payment authorization with the payer key and wrap it as an x402 payload. */
export async function signPaymentPayload(
  payerPrivateKey: Hex,
  auth: PaymentAuthorization,
  scheme: PaymentScheme = "exact",
): Promise<PaymentPayload> {
  const account = privateKeyToAccount(payerPrivateKey);
  const signature = await account.signTypedData(authTypedData(auth));
  return {
    x402Version: X402_VERSION,
    scheme,
    network: auth.network,
    authorization: auth,
    signature,
  };
}

export async function recoverPaymentSigner(payload: PaymentPayload): Promise<Address> {
  return recoverTypedDataAddress({
    ...authTypedData(payload.authorization),
    signature: payload.signature,
  });
}

export async function verifyPaymentPayload(payload: PaymentPayload): Promise<boolean> {
  return verifyTypedData({
    ...authTypedData(payload.authorization),
    address: getAddress(payload.authorization.from),
    signature: payload.signature,
  });
}

/** Deterministic settlement tx hash for the local (non-chain) facilitator. */
export function simulateTxHash(auth: PaymentAuthorization): Hex {
  return keccak256(toBytes(canonicalJson({ ...auth, settlementKind: "local-facilitator" })));
}

export class NonceAlreadyConsumedError extends Error {
  constructor(nonce: Hex) {
    super(`Payment nonce ${nonce} was already consumed`);
    this.name = "NonceAlreadyConsumedError";
  }
}

export class InvalidPaymentSignatureError extends Error {
  constructor() {
    super("Payment authorization signature is invalid");
    this.name = "InvalidPaymentSignatureError";
  }
}

/**
 * Chain a facilitator is willing to settle for. The CLB nonce is identical on
 * every chain (it is H(C), independent of where it is spent) and each
 * facilitator owns a separate consumed-nonce store, so without this check the
 * same signed bytes settle once per chain.
 */
export type FacilitatorChain = {
  chainId: number;
  /** x402 network label. When omitted, only `chainId` is enforced. */
  network?: string;
};

/** Local/demo facilitators simulate Base Sepolia settlement. */
export const DEFAULT_FACILITATOR_CHAIN: FacilitatorChain = {
  chainId: baseSepolia.id,
  network: "base-sepolia",
};

/** Resolve the facilitator's own chain from deployment configuration. */
export function defaultFacilitatorChain(): FacilitatorChain {
  const raw = process.env.CHAIN_ID?.trim();
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  const network = process.env.X402_NETWORK?.trim();
  if (Number.isInteger(parsed) && parsed > 0 && parsed !== baseSepolia.id) {
    // Non-default chain: network labels are deployment-specific, so bind on chainId only.
    return { chainId: parsed, ...(network ? { network } : {}) };
  }
  return {
    chainId: baseSepolia.id,
    network: network ?? DEFAULT_FACILITATOR_CHAIN.network,
  };
}

export class ChainMismatchError extends Error {
  readonly expectedChainId: number;
  readonly actualChainId: number;
  readonly expectedNetwork?: string;
  readonly actualNetwork: string;

  constructor(expected: FacilitatorChain, actual: PaymentAuthorization) {
    super(
      `Payment authorization targets chain ${actual.chainId} (${actual.network}), ` +
        `but this facilitator only settles chain ${expected.chainId}` +
        (expected.network ? ` (${expected.network})` : ""),
    );
    this.name = "ChainMismatchError";
    this.expectedChainId = expected.chainId;
    this.actualChainId = actual.chainId;
    this.expectedNetwork = expected.network;
    this.actualNetwork = actual.network;
  }
}

function chainMatches(chain: FacilitatorChain | null, payload: PaymentPayload): boolean {
  if (chain === null) return true;
  const auth = payload.authorization;
  return (
    auth.chainId === chain.chainId &&
    (chain.network === undefined || auth.network === chain.network)
  );
}

export type Facilitator = {
  settle(payload: PaymentPayload): Promise<SettlementReceipt>;
  verify(payload: PaymentPayload): Promise<boolean>;
  getSettlement(nonce: Hex): SettlementReceipt | null;
  isConsumed(nonce: Hex): boolean;
};

/**
 * Local x402 facilitator adapter. Enforces single-use nonces (P3 freshness)
 * and signature validity, returning a simulated on-chain settlement receipt.
 * A Base Sepolia facilitator can replace this behind the same interface.
 */
function buildSettlementReceipt(auth: PaymentAuthorization, txHash: Hex): SettlementReceipt {
  return {
    settled: true,
    txHash,
    payer: getAddress(auth.from),
    payTo: getAddress(auth.to),
    value: auth.value,
    asset: auth.asset,
    network: auth.network,
    chainId: auth.chainId,
    nonce: auth.nonce,
    settledAt: new Date().toISOString(),
  };
}

/**
 * Nonce reservation store shared by every facilitator that must agree on which
 * nonces are spent. `reserve` MUST be atomic: two concurrent callers for the
 * same nonce may never both receive `true`. A single-process implementation can
 * rely on the JS event loop; a multi-replica one needs a real atomic primitive
 * (Redis SETNX, a unique index, a conditional UPDATE).
 */
export type NonceStore = {
  reserve(nonce: Hex): Promise<boolean>;
  commit(nonce: Hex, receipt: SettlementReceipt): Promise<void>;
  release(nonce: Hex): Promise<void>;
  get(nonce: Hex): SettlementReceipt | null;
  isConsumed(nonce: Hex): boolean;
};

export function createInMemoryNonceStore(): NonceStore {
  const consumed = new Map<Hex, SettlementReceipt>();
  const inFlight = new Set<Hex>();

  return {
    async reserve(nonce) {
      if (consumed.has(nonce) || inFlight.has(nonce)) {
        return false;
      }
      // Synchronous check-and-set: no await between the read and the write, so
      // another caller cannot slip in between them.
      inFlight.add(nonce);
      return true;
    },
    async commit(nonce, receipt) {
      consumed.set(nonce, receipt);
      inFlight.delete(nonce);
    },
    async release(nonce) {
      inFlight.delete(nonce);
    },
    get(nonce) {
      return consumed.get(nonce) ?? null;
    },
    isConsumed(nonce) {
      return consumed.has(nonce);
    },
  };
}

function inMemoryFacilitator(
  settleFn: (payload: PaymentPayload) => Promise<SettlementReceipt>,
  options: { store?: NonceStore; chain?: FacilitatorChain | null } = {},
): Facilitator {
  const store = options.store ?? createInMemoryNonceStore();
  const chain = options.chain ?? null;

  return {
    async verify(payload) {
      if (!chainMatches(chain, payload)) return false;
      return verifyPaymentPayload(payload);
    },
    async settle(payload) {
      // Fail closed before touching the nonce store: a payload signed for chain
      // A must never consume a slot in chain B's facilitator.
      if (chain && !chainMatches(chain, payload)) {
        throw new ChainMismatchError(chain, payload.authorization);
      }
      if (!(await verifyPaymentPayload(payload))) {
        throw new InvalidPaymentSignatureError();
      }

      const nonce = payload.authorization.nonce;
      if (!(await store.reserve(nonce))) {
        throw new NonceAlreadyConsumedError(nonce);
      }

      try {
        const receipt = await settleFn(payload);
        await store.commit(nonce, receipt);
        return receipt;
      } catch (error) {
        // A failed settlement releases the reservation so a legitimate retry
        // can proceed. Successful settlements remain blocked by `consumed`.
        await store.release(nonce);
        throw error;
      }
    },
    getSettlement(nonce) {
      return store.get(nonce);
    },
    isConsumed(nonce) {
      return store.isConsumed(nonce);
    },
  };
}

export function createLocalFacilitator(
  store?: NonceStore,
  chain: FacilitatorChain | null = defaultFacilitatorChain(),
): Facilitator {
  return inMemoryFacilitator(
    async (payload) =>
      buildSettlementReceipt(payload.authorization, simulateTxHash(payload.authorization)),
    { store, chain },
  );
}

export type HttpFacilitatorOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** Chain this remote facilitator settles for; pass `null` for a multi-chain service. */
  chain?: FacilitatorChain | null;
};

/** Remote x402 facilitator client (Base Sepolia or hosted facilitator). */
export function createHttpFacilitator(options: HttpFacilitatorOptions): Facilitator {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/u, "");

  return inMemoryFacilitator(
    async (payload) => {
      const response = await fetchImpl(`${baseUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Facilitator settlement failed (${response.status})`);
      }

      return (await response.json()) as SettlementReceipt;
    },
    { chain: options.chain ?? defaultFacilitatorChain() },
  );
}

export type OnChainFacilitatorOptions = {
  rpcUrl: string;
  privateKey: Hex;
  chainId?: number;
  /** Override binding; defaults to `{ chainId }` (chainId-only, network is RPC-inferred). */
  chain?: FacilitatorChain | null;
};

/**
 * Base Sepolia settlement adapter. Verifies the authorization locally, then
 * publishes a real on-chain transaction so the receipt carries a chain tx hash.
 * Production deployments should point `X402_FACILITATOR_URL` at a hosted facilitator
 * or extend this adapter with EIP-3009 USDC settlement.
 */
export function createOnChainFacilitator(options: OnChainFacilitatorOptions): Facilitator {
  const chainId = options.chainId ?? baseSepolia.id;
  const chain = chainId === baseSepolia.id ? baseSepolia : baseSepolia;
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return inMemoryFacilitator(
    async (payload) => {
      const auth = payload.authorization;
      const txHash = await walletClient.sendTransaction({
        to: getAddress(auth.to),
        value: BigInt(0),
        data: keccak256(
          toBytes(canonicalJson({ kind: "x402-settlement", auth, signature: payload.signature })),
        ),
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return buildSettlementReceipt(auth, txHash);
    },
    { chain: options.chain === undefined ? { chainId } : options.chain },
  );
}

export type FacilitatorMode = "local" | "http" | "chain";

const ANVIL_SHOPPER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

function isValidPrivateKey(value: string | undefined): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value);
}

function resolveSettlerPrivateKey(): Hex | undefined {
  const candidates = [
    process.env.SHOPPING_AGENT_PRIVATE_KEY?.trim(),
    process.env.DEPLOYER_PRIVATE_KEY?.trim(),
    ANVIL_SHOPPER_KEY,
  ];
  for (const candidate of candidates) {
    if (isValidPrivateKey(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Resolve the active facilitator from environment variables. */
export function createFacilitator(mode?: FacilitatorMode): Facilitator {
  const explicit =
    mode ??
    (process.env.X402_FACILITATOR_MODE?.trim().toLowerCase() as FacilitatorMode | undefined);
  const facilitatorUrl = process.env.X402_FACILITATOR_URL?.trim();
  const rpcUrl = process.env.RPC_URL_BASE_SEPOLIA?.trim() ?? process.env.RPC_URL?.trim();
  const settlerKey = resolveSettlerPrivateKey();
  const assetAddress = process.env.X402_ASSET_ADDRESS?.trim();
  const chain = defaultFacilitatorChain();

  if (explicit === "http" || (!explicit && facilitatorUrl)) {
    return createHttpFacilitator({ baseUrl: facilitatorUrl ?? "http://localhost:8787", chain });
  }

  const wantsChain =
    explicit === "chain" || (!explicit && Boolean(rpcUrl && settlerKey && assetAddress));
  if (wantsChain && rpcUrl && settlerKey) {
    return createOnChainFacilitator({
      rpcUrl,
      privateKey: settlerKey,
      chainId: chain.chainId,
      chain,
    });
  }

  return createLocalFacilitator(undefined, chain);
}

export * from "./concurrency";
