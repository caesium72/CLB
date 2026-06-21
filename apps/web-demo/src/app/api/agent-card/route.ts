import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Public ERC-8004 registration card for the CLB-ACEL Weather Agent, in the canonical
// `registration-v1` schema so ERC-8004 explorers (8004scan / 8004agents.ai) render it natively.
// Served self-referencing: the card's service endpoints point at whatever host serves this route,
// so it works on any Vercel domain without hardcoding. Registered on-chain as the agent's tokenURI.
function baseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export async function GET(request: Request): Promise<NextResponse> {
  const base = baseUrl(request);
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "CLB-ACEL Weather Agent",
    description:
      "A demo trustless agent that returns a weather update for a city. Its identity lives on the " +
      "canonical ERC-8004 Identity Registry; its cross-layer-binding verification certificates are " +
      "recorded on-chain as ERC-8004 validation entries.",
    image: "",
    services: [{ name: "weather", endpoint: `${base}/api/weather` }],
    x402Support: true,
    active: true,
    supportedTrust: ["cross-layer-binding"],
  };
  return NextResponse.json(card, {
    headers: { "cache-control": "public, max-age=60" },
  });
}
