import {
  Anchor,
  Compass,
  CreditCard,
  EyeOff,
  GitBranch,
  Network,
  PenLine,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Swords,
  Target,
  type LucideIcon,
} from "lucide-react";

/**
 * Information architecture for the guided demo. Steps are grouped into a three-act
 * story (Setup -> Agent run -> Proof) plus two standalone labs, with an Overview
 * landing. `demoSteps` stays flat for pathname lookup / mobile pills; `demoActs`
 * is the grouped view the sidebar renders. demo-shell.tsx is the only consumer.
 */
export type DemoActId = "overview" | "setup" | "run" | "proof" | "attack-lab" | "privacy-lab";

export type DemoStep = {
  href: string;
  /** Plain-language nav label. */
  label: string;
  /** Page heading. */
  title: string;
  /** One-line page description shown in the page header. */
  pageDescription: string;
  /** Short hint shown under the label in the sidebar. */
  navHint: string;
  icon: LucideIcon;
  act: DemoActId;
};

export const demoSteps: DemoStep[] = [
  {
    href: "/overview",
    label: "Overview",
    title: "What this demo proves",
    pageDescription:
      "Three protocols — identity, authorization, and payment — bound into one tamper-evident commitment.",
    navHint: "The contribution at a glance",
    icon: Compass,
    act: "overview",
  },

  // Act 1 — Setup
  {
    href: "/intent",
    label: "Set the task & rules",
    title: "Tell your agent what you need",
    pageDescription:
      "Describe the task and the rules your agent must respect. Your agent then chooses an on-chain agent that fits.",
    navHint: "Task, budget, allowed agents",
    icon: Target,
    act: "setup",
  },

  // Act 2 — Agent run
  {
    href: "/discovery",
    label: "Agent chooses",
    title: "Your agent chooses an on-chain agent",
    pageDescription:
      "The shopping agent reads both ERC-8004 cards and decides — with reasoning — which one can do the task within your rules.",
    navHint: "LLM decision + reasoning",
    icon: Network,
    act: "run",
  },
  {
    href: "/quote",
    label: "Cart or limits",
    title: "Quote and cart",
    pageDescription: "Review the exact cart you will approve, or the spending limits your agent must obey.",
    navHint: "Line item or spending rules",
    icon: ShoppingCart,
    act: "run",
  },
  {
    href: "/mandate",
    label: "Authorize",
    title: "Authorize payment",
    pageDescription: "Sign once — the exact cart (Mode A) or a spending predicate (Mode B).",
    navHint: "One signature binds the layers",
    icon: PenLine,
    act: "run",
  },
  {
    href: "/checkout",
    label: "Agent pays",
    title: "Agent checkout",
    pageDescription: "The agent requests the work, receives 402 Payment Required, and settles on-chain.",
    navHint: "402, then settle",
    icon: CreditCard,
    act: "run",
  },
  {
    href: "/payment",
    label: "Receipt",
    title: "Payment receipt",
    pageDescription: "Settlement summary and the commitment nonce that pins this exact payment.",
    navHint: "Settlement receipt",
    icon: Receipt,
    act: "run",
  },

  // Act 3 — Proof
  {
    href: "/evidence",
    label: "Evidence",
    title: "Evidence graph",
    pageDescription: "A tamper-evident hash chain and Merkle root over every protocol event in the trace.",
    navHint: "Tamper-evident event trace",
    icon: GitBranch,
    act: "proof",
  },
  {
    href: "/verifier",
    label: "Verdict",
    title: "Audit result",
    pageDescription: "A deterministic verifier certificate — rules R1–R17, with no LLM in the loop.",
    navHint: "Deterministic certificate",
    icon: ShieldCheck,
    act: "proof",
  },
  {
    href: "/anchor",
    label: "On-chain proof",
    title: "On-chain proof",
    pageDescription:
      "Open the real settlement, the Merkle-root anchor, and both agents' identities on the block explorers.",
    navHint: "Explorer links to the truth",
    icon: Anchor,
    act: "proof",
  },

  // Labs
  {
    href: "/privacy",
    label: "Privacy Lab",
    title: "Privacy & metadata",
    pageDescription: "Prove a payment is valid while keeping the payee and exact amount off-chain.",
    navHint: "Confidential commit-and-prove",
    icon: EyeOff,
    act: "privacy-lab",
  },
  {
    href: "/attacks",
    label: "Attack Lab",
    title: "Attack simulator",
    pageDescription:
      "Replay the paper's attacks against weaker baselines and watch the full stack stop them.",
    navHint: "Five attacks, reproduced",
    icon: Swords,
    act: "attack-lab",
  }
];

type ActMeta = { kicker: string; title: string; description: string };

const ACT_META: Record<DemoActId, ActMeta> = {
  overview: { kicker: "Start here", title: "Overview", description: "The contribution at a glance" },
  setup: { kicker: "Act 1", title: "Setup", description: "You set the task and the rules" },
  run: { kicker: "Act 2", title: "Agent run", description: "It discovers, you authorize, it settles" },
  proof: { kicker: "Act 3", title: "Proof", description: "Evidence, verdict, and on-chain truth" },
  "privacy-lab": { kicker: "Lab", title: "Privacy Lab", description: "Verify without revealing" },
  "attack-lab": { kicker: "Lab", title: "Attack Lab", description: "Why single-layer stacks fail" },
};

const ACT_ORDER: DemoActId[] = ["overview", "setup", "run", "proof", "privacy-lab", "attack-lab"];

export type DemoAct = ActMeta & { id: DemoActId; steps: DemoStep[] };

export const demoActs: DemoAct[] = ACT_ORDER.map((id) => ({
  id,
  ...ACT_META[id],
  steps: demoSteps.filter((step) => step.act === id),
}));

export function getDemoStep(pathname: string): DemoStep | undefined {
  return demoSteps.find((step) => step.href === pathname);
}

export function getAct(id: DemoActId): DemoAct {
  return demoActs.find((act) => act.id === id)!;
}
