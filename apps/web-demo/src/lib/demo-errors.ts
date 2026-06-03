function extractNonce(message: string): string | null {
  const match = message.match(/nonce\s+(0x[a-fA-F0-9]+)/);
  return match?.[1] ?? null;
}

export function friendlyDemoError(error: unknown, fallback = "Demo action failed"): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const nonce = extractNonce(raw);

  if (/already consumed/i.test(raw)) {
    return nonce
      ? `This payment was already settled. Create or sign a fresh mandate before running it again. Consumed nonce: ${nonce}.`
      : "This payment was already settled. Create or sign a fresh mandate before running it again.";
  }

  if (/No browser wallet detected/i.test(raw)) {
    return "No browser wallet was found. Connect MetaMask/Rabby, or use the demo account for a walletless walkthrough.";
  }

  if (/Failed to fetch|fetch failed|ECONNREFUSED|Service request failed/i.test(raw)) {
    return "A local demo service is not reachable. Start the Phase 5 services, then retry the step.";
  }

  return raw || fallback;
}
