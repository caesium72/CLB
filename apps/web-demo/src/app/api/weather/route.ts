import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Deterministic demo weather — no external API key required, stable per city so the demo is
// reproducible. This is the *service* the CLB-ACEL Weather Agent advertises in its ERC-8004 card.
const CONDITIONS = [
  "Clear",
  "Partly cloudy",
  "Cloudy",
  "Light rain",
  "Showers",
  "Windy",
  "Foggy",
  "Sunny",
] as const;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const city = (url.searchParams.get("city") ?? "London").trim() || "London";
  const seed = hashString(city.toLowerCase());
  const temperatureC = (seed % 35) - 5; // -5..29 °C, stable per city
  const condition = CONDITIONS[seed % CONDITIONS.length];

  return NextResponse.json({
    agent: "CLB-ACEL Weather Agent",
    city,
    temperatureC,
    condition,
    summary: `${condition} in ${city}, around ${temperatureC}°C.`,
    source: "demo-deterministic",
    generatedAt: new Date().toISOString(),
  });
}
