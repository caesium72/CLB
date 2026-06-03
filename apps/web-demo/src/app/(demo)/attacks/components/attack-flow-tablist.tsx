"use client";

import { motion, useReducedMotion } from "motion/react";
import { FLOW_LABELS } from "@/lib/demo-copy";
import { cn } from "@/lib/utils";

export type AttackFlowTab = "binding" | "predicate";

const FLOW_TABS: AttackFlowTab[] = ["binding", "predicate"];

type AttackFlowTablistProps = {
  activeTab: AttackFlowTab;
  onChange: (tab: AttackFlowTab) => void;
  research: boolean;
};

/**
 * Segment-style flow switcher. The shared `layoutId` pill slides between tabs
 * without fragile offset measurements (fixes misaligned indicator bugs).
 */
export function AttackFlowTablist({ activeTab, onChange, research }: AttackFlowTablistProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Choose a shopping flow
      </p>
      <div
        role="tablist"
        aria-label="Attack simulator shopping flows"
        className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:max-w-2xl"
      >
        {FLOW_TABS.map((tab) => {
          const labels = tab === "binding" ? FLOW_LABELS.modeA : FLOW_LABELS.modeB;
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`attacks-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`attacks-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab)}
              className={cn(
                "relative flex min-h-11 flex-col items-start justify-center rounded-md px-3 py-2 text-left text-sm outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected ? "text-foreground" : "text-foreground/55 hover:text-foreground",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId="attack-flow-indicator"
                  className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-border/50"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10 flex items-start gap-2">
                {!selected ? (
                  <motion.span
                    aria-hidden
                    className="mt-1.5 flex size-2.5 shrink-0 items-center justify-center"
                    animate={
                      reducedMotion
                        ? { opacity: 0.9 }
                        : {
                            scale: [1, 1.15, 1],
                            opacity: [0.65, 1, 0.65],
                          }
                    }
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  >
                    <span className="absolute inset-0 rounded-full bg-blue-500/40 blur-[3px]" />
                    <span className="relative size-2 rounded-full bg-blue-500 shadow-[0_0_8px_2px] shadow-blue-500/50" />
                  </motion.span>
                ) : null}
                <span className="font-semibold leading-snug">{labels.tab}</span>
              </span>
              {research ? (
                <span className="relative z-10 text-xs leading-snug text-muted-foreground">
                  {labels.research}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { FLOW_TABS };
