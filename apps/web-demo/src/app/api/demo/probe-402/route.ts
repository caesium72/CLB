import { NextResponse } from "next/server";
import { jsonError, serviceUrls } from "../_lib";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return jsonError("token query parameter is required");

  try {
    const response = await fetch(
      `${serviceUrls.merchant}/risk-report?token=${encodeURIComponent(token)}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (response.status === 402) {
      return NextResponse.json({ status: 402, paymentRequired: payload }, { status: 200 });
    }

    return NextResponse.json(
      {
        status: response.status,
        error: "Expected 402 Payment Required before settlement",
        body: payload,
      },
      { status: 502 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Probe failed" },
      { status: 502 },
    );
  }
}
