/**
 * In-process orchestration facade used by the web app's `/api/demo/*` route
 * handlers. This replaces the old BFF-proxy-to-Fastify model: every step runs the
 * monorepo adapter packages directly, so the deployed Vercel app needs no separate
 * services at runtime (real Base Sepolia settlement still happens via the
 * env-driven x402 facilitator inside `runHumanPresent` / `runDelegated`).
 */
import {
  createIntent,
  discoverInProcess,
  prepareInProcess,
  quoteInProcess,
  runDelegated,
  runHumanPresent,
  serviceKindForIntent,
  servicePaymentFraming,
  type DiscoveryResult,
  type Intent,
  type PreparedDelegated,
  type PreparedHumanPresent,
  type QuoteResult,
  type VerifyTraceOutput,
} from "@clb-acel/agent-orchestrator/inproc";
import { ensureMonorepoEnv } from "./env";
import { getIntent, getTrace, putIntent, putTrace, type StoredTrace } from "./store";

ensureMonorepoEnv();

export type DemoMode = "a" | "b";

export type IntentInput = {
  token?: string;
  task?: string;
  /** Service subject the agent operates on (text to proofread / city). */
  input?: string;
  budget?: string;
  asset?: string;
  network?: string;
  /** Discovery predicate: restrict which agent IDs the shopper may select. */
  allowedAgentIds?: string[];
  /** Mode B only: predicate validity deadline (ISO 8601). */
  validUntil?: string;
  intentId?: string;
};

export function parseAllowedAgentIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

export async function createDemoIntent(input: IntentInput): Promise<Intent> {
  const intent = createIntent({ token: input.token ?? "XYZ", ...input });
  await putIntent(intent);
  return intent;
}

/**
 * Resolve the Intent for a step: prefer the server-stored intent (created at
 * `/intent`), else rebuild from any fields the client sent (cross-instance
 * fallback), else a default intent.
 */
export async function resolveIntent(body: Record<string, unknown>): Promise<Intent> {
  const intentId = typeof body.intentId === "string" ? body.intentId : undefined;
  if (intentId) {
    const stored = await getIntent(intentId);
    if (stored) return stored;
  }
  const maybeIntent = body.intent as Partial<Intent> | undefined;
  if (maybeIntent?.intentId && maybeIntent.token) {
    return createDemoIntent(maybeIntent as IntentInput);
  }
  return createDemoIntent({
    intentId,
    token: typeof body.token === "string" ? body.token : undefined,
    task: typeof body.task === "string" ? body.task : undefined,
    input: typeof body.input === "string" ? body.input : undefined,
    budget: typeof body.budget === "string" ? body.budget : undefined,
    asset: typeof body.asset === "string" ? body.asset : undefined,
    network: typeof body.network === "string" ? body.network : undefined,
    allowedAgentIds: parseAllowedAgentIds(body.allowedAgentIds),
    validUntil: typeof body.validUntil === "string" ? body.validUntil : undefined,
  });
}

export async function discover(intent: Intent): Promise<DiscoveryResult> {
  return discoverInProcess(intent);
}

export async function quote(intent: Intent, mode: DemoMode): Promise<QuoteResult> {
  return quoteInProcess(intent, mode);
}

export async function prepare(
  intent: Intent,
  mode: DemoMode,
  humanPrincipal?: string,
): Promise<PreparedHumanPresent | PreparedDelegated> {
  return prepareInProcess(
    intent,
    mode,
    humanPrincipal ? { humanPrincipal: humanPrincipal as `0x${string}` } : {},
  );
}

/**
 * Synthetic 402 for the checkout step, computed in-process from a Mode A quote.
 * The real 402 happens inside `run`; this just drives the "Payment Required" UI.
 * Resolve the buyer's ACTUAL intent (by intentId) so the 402 reflects the agent
 * that was selected (grammar vs weather) — not a default token-risk template.
 */
export async function probe402(params: { token?: string; intentId?: string }) {
  const stored = params.intentId ? await getIntent(params.intentId) : undefined;
  const intent = stored ?? (await createDemoIntent({ token: params.token ?? "XYZ" }));
  const q = await quoteInProcess(intent, "a");
  if (q.kind !== "cart") {
    return { status: 402, paymentRequired: null };
  }
  const kind = serviceKindForIntent({ task: intent.task, token: intent.token });
  const framing = servicePaymentFraming(kind, intent);
  return {
    status: 402,
    paymentRequired: {
      x402Version: 1,
      accepts: [
        {
          scheme: q.settlementDescriptor.x402Scheme,
          network: q.settlementDescriptor.network,
          asset: q.settlementDescriptor.asset,
          payTo: q.settlementDescriptor.payTo,
          maxAmountRequired: q.settlementDescriptor.value,
          resource: `acel://merchant/${q.merchantAgentId}/${framing.resourcePath}`,
          description: framing.description,
        },
      ],
      settlementDescriptor: q.settlementDescriptor,
    },
  };
}

/**
 * Phase 0 mandate registration: the in-process `run` signs the mandate server-side,
 * so this just acknowledges the (optionally wallet-signed) draft and returns its id.
 * Phase 3 reworks this into real browser-wallet verification.
 */
export function registerMandate(body: Record<string, unknown>): { mandateId: string; accepted: true } {
  const draft = body.mandateDraft as { mandateId?: string } | undefined;
  const mandateId =
    draft?.mandateId ?? (typeof body.mandateId === "string" ? body.mandateId : `mandate-${Date.now()}`);
  return { mandateId, accepted: true };
}

/** Run the full flow in-process, persist it, and return it. */
export async function run(intent: Intent, mode: DemoMode): Promise<StoredTrace> {
  const trace = mode === "b" ? await runDelegated(intent) : await runHumanPresent(intent);
  await putTrace(trace);
  return trace;
}

export async function storedTrace(traceId: string): Promise<StoredTrace | undefined> {
  return getTrace(traceId);
}

export async function evidenceView(traceId: string) {
  const trace = await getTrace(traceId);
  if (!trace) return null;
  return {
    traceId: trace.traceId,
    events: trace.events,
    eventHashes: trace.eventHashes,
    merkleRoot: trace.merkleRoot,
    graph: trace.graph,
  };
}

export async function verification(traceId: string): Promise<VerifyTraceOutput | null> {
  return (await getTrace(traceId))?.verification ?? null;
}

export type { Intent, DiscoveryResult, QuoteResult, StoredTrace };
