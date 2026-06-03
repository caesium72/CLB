import type { EvidenceEdge } from "@clb-acel/schemas";

export const PROTOCOL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  USER: { bg: "bg-slate-100", border: "border-slate-300", text: "text-slate-800" },
  ERC8004: { bg: "bg-violet-100", border: "border-violet-300", text: "text-violet-900" },
  AP2: { bg: "bg-sky-100", border: "border-sky-300", text: "text-sky-900" },
  ACP: { bg: "bg-cyan-100", border: "border-cyan-300", text: "text-cyan-900" },
  X402: { bg: "bg-amber-100", border: "border-amber-300", text: "text-amber-900" },
  CHAIN: { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900" },
  DELIVERY: { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-900" },
  VERIFICATION: { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-900" },
};

export const DEFAULT_PROTOCOL_COLOR = {
  bg: "bg-muted",
  border: "border-border",
  text: "text-foreground",
};

export const EDGE_THEME: Record<
  EvidenceEdge,
  { stroke: string; dash?: string; label: string; description: string }
> = {
  BINDS_TO: {
    stroke: "#94a3b8",
    dash: "4 4",
    label: "BINDS_TO",
    description: "Tamper-evident hash chain link",
  },
  AUTHORIZES: {
    stroke: "#6366f1",
    label: "AUTHORIZES",
    description: "Identity or mandate authorizes the next protocol step",
  },
  PAYS_FOR: {
    stroke: "#d97706",
    label: "PAYS_FOR",
    description: "Payment payload commits to a requirement",
  },
  SETTLES: {
    stroke: "#059669",
    label: "SETTLES",
    description: "On-chain settlement finalizes payment",
  },
  DELIVERS: {
    stroke: "#ea580c",
    label: "DELIVERS",
    description: "Settlement unlocks delivery proof",
  },
  VALIDATES: {
    stroke: "#e11d48",
    label: "VALIDATES",
    description: "Verifier certificate attests the trace",
  },
  RATES: {
    stroke: "#7c3aed",
    label: "RATES",
    description: "Feedback rates the agent after verification",
  },
};

export function protocolColors(protocol: string) {
  return PROTOCOL_COLORS[protocol] ?? DEFAULT_PROTOCOL_COLOR;
}
