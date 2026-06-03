import type { DemoMode, DemoRunState } from "@/components/demo-run-provider";

export type DemoStepId =
  | "intent"
  | "discovery"
  | "quote"
  | "mandate"
  | "checkout"
  | "payment"
  | "evidence"
  | "verifier"
  | "attacks"
  | "anchor";

/** Linear happy-path order; attacks is nav step 0 but not in this chain. */
const HAPPY_PATH_ORDER: DemoStepId[] = [
  "intent",
  "discovery",
  "quote",
  "mandate",
  "checkout",
  "payment",
  "evidence",
  "verifier",
  "anchor",
];

export function stepHref(step: DemoStepId): string {
  return `/${step}`;
}

export function canAccessStep(step: DemoStepId, state: DemoRunState): boolean {
  switch (step) {
    case "intent":
      return true;
    case "discovery":
      return Boolean(state.intentId);
    case "quote":
      return Boolean(state.discovery?.selectedMerchantId);
    case "mandate":
      if (state.mode === "a") return Boolean(state.quote);
      return Boolean(state.discovery?.selectedMerchantId);
    case "checkout":
      return Boolean(state.mandateId);
    case "payment":
    case "evidence":
    case "verifier":
    case "anchor":
      return Boolean(state.traceId);
    case "attacks":
      return true;
    default:
      return false;
  }
}

export function gateMessage(step: DemoStepId, state: DemoRunState): { title: string; description: string; href: string } {
  if (canAccessStep(step, state)) {
    return { title: "", description: "", href: stepHref(step) };
  }

  switch (step) {
    case "discovery":
      return {
        title: "Create an intent first",
        description: "Tell your shopping agent what you need in step 1.",
        href: "/intent",
      };
    case "quote":
      return {
        title: "Finish agent discovery",
        description: "Let the shopping agent find a merchant before requesting a quote.",
        href: "/discovery",
      };
    case "mandate":
      return state.mode === "a"
        ? {
            title: "Review the quote first",
            description: "See what the agent wants to buy before you authorize payment.",
            href: "/quote",
          }
        : {
            title: "Finish agent discovery",
            description: "The agent needs a merchant candidate before you set spending limits.",
            href: "/discovery",
          };
    case "checkout":
      return {
        title: "Sign authorization first",
        description: "Authorize the cart or spending limits before the agent can pay.",
        href: "/mandate",
      };
    case "payment":
    case "evidence":
    case "verifier":
    case "anchor":
      return {
        title: "Run agent checkout first",
        description: "Watch the agent hit 402 and settle before viewing the receipt.",
        href: "/checkout",
      };
    default:
      return { title: "Not ready", description: "Complete earlier steps first.", href: "/intent" };
  }
}

export function nextStepAfter(step: DemoStepId): DemoStepId | null {
  const index = HAPPY_PATH_ORDER.indexOf(step);
  return index >= 0 && index < HAPPY_PATH_ORDER.length - 1 ? HAPPY_PATH_ORDER[index + 1]! : null;
}

export function continueLabel(step: DemoStepId, mode: DemoMode): string {
  switch (step) {
    case "intent":
      return "Continue to discovery";
    case "discovery":
      return "Continue to quote";
    case "quote":
      return mode === "b" ? "Continue to set limits" : "Continue to authorize";
    case "mandate":
      return "Continue to agent checkout";
    case "checkout":
      return "View payment receipt";
    case "payment":
      return "View evidence graph";
    case "evidence":
      return "View audit result";
    case "verifier":
      return "Anchor on chain";
    default:
      return "Continue";
  }
}
