import { NextResponse } from "next/server";
import { ensureMonorepoEnv } from "@/server/clb/env";
import { storeHealth } from "@/server/clb/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deploy diagnostic: reports whether trace persistence is configured and the DB
 * is reachable. On Vercel, "Trace not found" almost always means this returns
 * persistence:"memory-only" (DATABASE_URL missing) or dbOk:false (connection
 * error) — both surface here instead of being silently swallowed.
 */
export async function GET() {
  ensureMonorepoEnv();
  return NextResponse.json(await storeHealth(), {
    headers: { "cache-control": "no-store" },
  });
}
