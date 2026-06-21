import { ShieldCheck, UserCheck, type LucideIcon } from "lucide-react";
import { FLOW_LABELS } from "@/lib/demo-copy";
import type { DemoMode } from "@/components/demo-run-provider";

/**
 * Per-mode visual identity. The base theme is monochrome, so the two flows are
 * distinguished by a single restrained accent each (cool for human-present, violet
 * for delegated) plus their own icon and plain-language statement. Used by the
 * shell header, the mode switch, and mode-aware panels.
 */
export type ModeTheme = {
  /** Commerce-language scenario name. */
  short: string;
  /** What the human does, in plain words. */
  plain: string;
  /** Research-mode protocol subtitle. */
  research: string;
  icon: LucideIcon;
  /** Colored pill (border + bg + text). */
  chipClass: string;
  /** Accent border for mode-aware cards. */
  accentBorder: string;
  /** Subtle accent background. */
  accentBg: string;
  /** Accent text/icon color. */
  accentText: string;
  /** Solid accent (for the active switch indicator / dots). */
  solid: string;
};

export const MODE_THEME: Record<DemoMode, ModeTheme> = {
  a: {
    short: FLOW_LABELS.modeA.short,
    plain: FLOW_LABELS.modeA.tab,
    research: FLOW_LABELS.modeA.research,
    icon: UserCheck,
    chipClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    accentBorder: "border-sky-500/40",
    accentBg: "bg-sky-500/5",
    accentText: "text-sky-700 dark:text-sky-300",
    solid: "bg-sky-500",
  },
  b: {
    short: FLOW_LABELS.modeB.short,
    plain: FLOW_LABELS.modeB.tab,
    research: FLOW_LABELS.modeB.research,
    icon: ShieldCheck,
    chipClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    accentBorder: "border-violet-500/40",
    accentBg: "bg-violet-500/5",
    accentText: "text-violet-700 dark:text-violet-300",
    solid: "bg-violet-500",
  },
};

export function modeTheme(mode: DemoMode): ModeTheme {
  return MODE_THEME[mode];
}
