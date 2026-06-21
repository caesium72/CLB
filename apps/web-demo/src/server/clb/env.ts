/**
 * Load the monorepo-root `.env` into `process.env` once, for local `next dev`.
 *
 * Next only auto-loads `.env` files inside the app directory; the in-process
 * adapters (x402 chain mode, canonical ERC-8004, LLM, anchor) read the shared
 * root `.env`. On Vercel, real env vars are already present in `process.env`, so
 * existing keys are never overwritten and the missing file is a no-op.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      // Quoted value: keep contents verbatim (a '#' inside quotes is data, not a comment).
      const quote = value[0];
      const end = value.indexOf(quote, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      // Unquoted value: strip an inline comment (' #...' or a leading '#').
      const commentAt = value.search(/\s#/);
      if (commentAt !== -1) value = value.slice(0, commentAt);
      else if (value.startsWith("#")) value = "";
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

export function ensureMonorepoEnv(): void {
  if (loaded) return;
  loaded = true;
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      const parsed = parseEnv(readFileSync(candidate, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
