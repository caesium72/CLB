import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let envCache: Record<string, string> | null = null;

function parseEnv(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    parsed[key] = value;
  }
  return parsed;
}

function readNearestEnv(): Record<string, string> {
  if (envCache) return envCache;

  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      envCache = parseEnv(readFileSync(candidate, "utf8"));
      return envCache;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  envCache = {};
  return envCache;
}

export function demoEnv(key: string): string | undefined {
  return process.env[key]?.trim() || readNearestEnv()[key]?.trim() || undefined;
}

export function demoChainId(): number {
  return Number(demoEnv("NEXT_PUBLIC_DEMO_CHAIN_ID") ?? demoEnv("CHAIN_ID") ?? 31337);
}

export const DEMO_CHAIN_ID = demoChainId();

export const serviceUrls = {
  orchestrator: demoEnv("AGENT_ORCHESTRATOR_URL") ?? "http://localhost:4000",
  evidence: demoEnv("EVIDENCE_SERVICE_URL") ?? "http://localhost:4001",
  mandate: demoEnv("MANDATE_SERVICE_URL") ?? "http://localhost:4003",
  merchant: demoEnv("MERCHANT_AGENT_URL") ?? "http://localhost:4004",
  verifier: demoEnv("VERIFIER_SERVICE_URL") ?? "http://localhost:4005",
};

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function proxyJson(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Service request failed" },
      { status: 502 },
    );
  }
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
