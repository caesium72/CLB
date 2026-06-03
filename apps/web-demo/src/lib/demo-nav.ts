import {
  Anchor,
  CreditCard,
  FileSearch,
  GitBranch,
  Network,
  ShieldCheck,
  ShoppingCart,
  Target,
  Zap,
} from "lucide-react";

export const demoSteps = [
  {
    href: "/attacks",
    label: "Attack Simulator",
    title: "Attack simulator",
    pageDescription:
      "Run attacks against both shopping flows and compare B0–B3 baseline outcomes live.",
    description: "Live attack matrix",
    icon: Zap,
    step: 0,
  },
  {
    href: "/intent",
    label: "Create Intent",
    title: "Tell your agent what you need",
    pageDescription: "Describe the task and spending budget for your shopping agent.",
    description: "User task and budget",
    icon: Target,
    step: 1,
  },
  {
    href: "/discovery",
    label: "Agent Discovery",
    title: "Agent finds a merchant",
    pageDescription: "Watch the shopping agent search ERC-8004 and select a merchant for your task.",
    description: "Agent merchant selection",
    icon: Network,
    step: 2,
  },
  {
    href: "/quote",
    label: "Quote / Cart",
    title: "Quote and cart",
    pageDescription: "Review what the agent wants to buy before you authorize payment.",
    description: "Line item or spending limits",
    icon: ShoppingCart,
    step: 3,
  },
  {
    href: "/mandate",
    label: "Authorize",
    title: "Authorize payment",
    pageDescription: "Sign once — exact cart (Mode A) or spending limits (Mode B).",
    description: "Wallet mandate signing",
    icon: FileSearch,
    step: 4,
  },
  {
    href: "/checkout",
    label: "Agent Checkout",
    title: "Agent checkout",
    pageDescription: "The shopping agent requests the report, receives 402, and settles payment.",
    description: "402 then settle",
    icon: CreditCard,
    step: 5,
  },
  {
    href: "/payment",
    label: "Receipt",
    title: "Payment receipt",
    pageDescription: "Settlement summary and CLB nonce binding for this trace.",
    description: "Settlement receipt",
    icon: CreditCard,
    step: 6,
  },
  {
    href: "/evidence",
    label: "Evidence Graph",
    title: "Evidence graph",
    pageDescription: "Tamper-evident hash chain and Merkle root over protocol events.",
    description: "Tamper-evident event trace",
    icon: GitBranch,
    step: 7,
  },
  {
    href: "/verifier",
    label: "Audit Result",
    title: "Audit result",
    pageDescription: "Deterministic verifier certificate — no LLM verification.",
    description: "Verifier certificate",
    icon: ShieldCheck,
    step: 8,
  },
  {
    href: "/anchor",
    label: "Audit Anchor",
    title: "On-chain anchor",
    pageDescription: "Anchor trace Merkle root on AgenticAuditAnchor.sol.",
    description: "Merkle root on-chain",
    icon: Anchor,
    step: 9,
  },
] as const;

export type DemoStepHref = (typeof demoSteps)[number]["href"];

export function getDemoStep(pathname: string) {
  return demoSteps.find((step) => step.href === pathname);
}

/** Steps 1–9: the live shopping walkthrough (excludes optional step 0 attacks). */
export const walkthroughSteps = demoSteps.filter((step) => step.step > 0);
