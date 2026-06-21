/**
 * Trace + intent store for the in-process (no-Fastify) demo backend.
 *
 * On Vercel each serverless invocation may run in a different instance (and cold
 * starts wipe memory), so a module-level Map alone loses traces between the `run`
 * route and the read-only proof routes (`trace`, `evidence`, `verify`, `anchor`)
 * — the user sees "Trace not found". When `DATABASE_URL` is set the store is
 * backed by Neon Postgres so traces are shared + durable across instances; the
 * in-memory Map is kept as an L1 cache (fast warm reads) and as the sole store
 * when no `DATABASE_URL` is configured (local dev behaves exactly as before).
 */
import type { Intent, ModeBTraceResult, TraceResult } from "@clb-acel/agent-orchestrator/inproc";
import pg from "pg";

const { Pool } = pg;

export type StoredTrace = TraceResult | ModeBTraceResult;

const MAX_TRACES = 50;
const MAX_INTENTS = 100;
/** How many rows to keep in Postgres (cheap bound; demo volume is tiny). */
const DB_TRACE_CAP = 500;
const DB_INTENT_CAP = 1000;

declare global {
  // Survive Next.js dev hot-reload (module re-evaluation) within one process.
  // eslint-disable-next-line no-var
  var __clbTraceStore: Map<string, StoredTrace> | undefined;
  // eslint-disable-next-line no-var
  var __clbIntentStore: Map<string, Intent> | undefined;
  // eslint-disable-next-line no-var
  var __clbPgPool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __clbPgReady: Promise<void> | undefined;
}

const store: Map<string, StoredTrace> = globalThis.__clbTraceStore ?? new Map();
globalThis.__clbTraceStore = store;

const intents: Map<string, Intent> = globalThis.__clbIntentStore ?? new Map();
globalThis.__clbIntentStore = intents;

function boundMap<V>(map: Map<string, V>, cap: number): void {
  while (map.size > cap) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

// ── Postgres backing (optional, enabled by DATABASE_URL) ──────────────────────

function pool(): pg.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!globalThis.__clbPgPool) {
    // Mirror evidence-service: rely on the URL's sslmode when present, else attach
    // a permissive ssl object (Neon needs TLS). Small pool — serverless friendly.
    const useSslObject = process.env.DATABASE_SSL !== "false" && !url.includes("sslmode=");
    globalThis.__clbPgPool = new Pool({
      connectionString: url,
      max: 2,
      ...(useSslObject ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return globalThis.__clbPgPool;
}

async function ensureTables(p: pg.Pool): Promise<void> {
  if (!globalThis.__clbPgReady) {
    globalThis.__clbPgReady = p
      .query(
        `create table if not exists clb_traces (
           trace_id text primary key,
           data jsonb not null,
           created_at timestamptz not null default now()
         );
         create table if not exists clb_intents (
           intent_id text primary key,
           data jsonb not null,
           created_at timestamptz not null default now()
         );`,
      )
      .then(() => undefined)
      .catch((error) => {
        // Reset so a later call can retry; surface as a no-DB fallback for this request.
        globalThis.__clbPgReady = undefined;
        throw error;
      });
  }
  return globalThis.__clbPgReady;
}

async function dbUpsert(
  table: "clb_traces" | "clb_intents",
  idCol: "trace_id" | "intent_id",
  id: string,
  data: unknown,
  cap: number,
): Promise<void> {
  const p = pool();
  if (!p) return;
  await ensureTables(p);
  await p.query(
    `insert into ${table} (${idCol}, data) values ($1, $2::jsonb)
     on conflict (${idCol}) do update set data = excluded.data, created_at = now()`,
    [id, JSON.stringify(data)],
  );
  // Lazy bound: drop everything beyond the most-recent `cap` rows.
  await p
    .query(
      `delete from ${table} where ${idCol} in (
         select ${idCol} from ${table} order by created_at desc offset ${cap}
       )`,
    )
    .catch(() => undefined);
}

async function dbGet<T>(
  table: "clb_traces" | "clb_intents",
  idCol: "trace_id" | "intent_id",
  id: string,
): Promise<T | undefined> {
  const p = pool();
  if (!p) return undefined;
  await ensureTables(p);
  const result = await p.query<{ data: T }>(
    `select data from ${table} where ${idCol} = $1 limit 1`,
    [id],
  );
  return result.rows[0]?.data;
}

// ── Public API (async; L1 Map cache + optional Postgres) ──────────────────────

export async function putIntent(intent: Intent): Promise<void> {
  intents.set(intent.intentId, intent);
  boundMap(intents, MAX_INTENTS);
  try {
    await dbUpsert("clb_intents", "intent_id", intent.intentId, intent, DB_INTENT_CAP);
  } catch {
    // Best-effort: the Map still holds it for warm reads on this instance.
  }
}

export async function getIntent(intentId: string): Promise<Intent | undefined> {
  const cached = intents.get(intentId);
  if (cached) return cached;
  let row: Intent | undefined;
  try {
    row = await dbGet<Intent>("clb_intents", "intent_id", intentId);
  } catch {
    row = undefined;
  }
  if (row) intents.set(intentId, row);
  return row;
}

export async function putTrace(trace: StoredTrace): Promise<void> {
  store.set(trace.traceId, trace);
  boundMap(store, MAX_TRACES);
  try {
    await dbUpsert("clb_traces", "trace_id", trace.traceId, trace, DB_TRACE_CAP);
  } catch (error) {
    // Best-effort: warm reads on this instance still resolve from the Map. Log so
    // a Vercel cross-instance miss ("Trace not found") is diagnosable.
    console.error("[clb-store] putTrace DB write failed:", (error as Error)?.message ?? error);
  }
}

export async function getTrace(traceId: string): Promise<StoredTrace | undefined> {
  const cached = store.get(traceId);
  if (cached) return cached;
  let row: StoredTrace | undefined;
  try {
    row = await dbGet<StoredTrace>("clb_traces", "trace_id", traceId);
  } catch (error) {
    console.error("[clb-store] getTrace DB read failed:", (error as Error)?.message ?? error);
    row = undefined;
  }
  if (row) store.set(traceId, row);
  return row;
}

export function isModeBTrace(trace: StoredTrace): trace is ModeBTraceResult {
  return (trace as ModeBTraceResult).mode === "MODE_B_PREDICATE";
}

/** Diagnostic: is persistence configured + reachable? Surfaced via /api/demo/health. */
export async function storeHealth(): Promise<{
  persistence: "postgres" | "memory-only";
  hasDatabaseUrl: boolean;
  dbOk?: boolean;
  traceRows?: number;
  intentRows?: number;
  error?: string;
}> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return { persistence: "memory-only", hasDatabaseUrl: false };
  try {
    const p = pool();
    if (!p) return { persistence: "memory-only", hasDatabaseUrl: false };
    await ensureTables(p);
    const traces = await p.query<{ n: number }>("select count(*)::int n from clb_traces");
    const intents = await p.query<{ n: number }>("select count(*)::int n from clb_intents");
    return {
      persistence: "postgres",
      hasDatabaseUrl: true,
      dbOk: true,
      traceRows: traces.rows[0]?.n,
      intentRows: intents.rows[0]?.n,
    };
  } catch (error) {
    return {
      persistence: "postgres",
      hasDatabaseUrl: true,
      dbOk: false,
      error: (error as Error)?.message ?? String(error),
    };
  }
}
