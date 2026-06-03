import type { EvidenceEvent } from "@clb-acel/schemas";
import type { TraceBundle } from "@clb-acel/verifier-core";
import { getAddress } from "viem";
import type { AuditCheckResult } from "./types";

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}

export function checkFakeFeedback(events: EvidenceEvent[]): AuditCheckResult {
  const hasFeedback = events.some((event) => event.objectType === "ERC8004_FEEDBACK");
  if (!hasFeedback) {
    return { ok: false, detail: "No ERC8004_FEEDBACK event was present" };
  }

  const hasCertificate = events.some((event) => event.objectType === "VERIFICATION_CERTIFICATE");
  return hasCertificate
    ? { ok: false, detail: "Feedback is backed by a verification certificate" }
    : { ok: true, detail: "Feedback event has no prior VERIFICATION_CERTIFICATE evidence" };
}

export function checkPromptInjection(bundle: TraceBundle): AuditCheckResult {
  const discovery = bundle.events.find((event) => event.objectType === "ERC8004_AGENT_SELECTION");
  const selectedPayee = discovery?.publicFields.selectedPayee;
  if (typeof selectedPayee !== "string") {
    return { ok: false, detail: "No selectedPayee was logged in discovery evidence" };
  }

  const allowedPayees = bundle.mandate.constraints.allowedPayees ?? [];
  const selectedAllowed = allowedPayees.some((payee) => sameAddress(payee, selectedPayee));
  return selectedAllowed
    ? { ok: false, detail: "Selected merchant was inside allowedPayees" }
    : { ok: true, detail: "Discovery selected a merchant outside allowedPayees" };
}
