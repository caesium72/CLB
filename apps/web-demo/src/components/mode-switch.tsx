"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { useDemoRun, type DemoMode } from "@/components/demo-run-provider";
import { MODE_THEME } from "@/lib/mode-theme";
import { cn } from "@/lib/utils";

export function ModeSwitch({
  mode: explicitMode,
  className,
  compact = false,
}: {
  mode?: DemoMode;
  className?: string;
  compact?: boolean;
}) {
  const { mode, setMode } = useDemoRun();
  const reducedMotion = useReducedMotion();
  const switchId = useId();
  const activeMode = explicitMode ?? mode;
  const options: Array<{ value: DemoMode; label: string; compactLabel: string }> = [
    { value: "a", label: "Mode A · exact", compactLabel: "Mode A" },
    { value: "b", label: "Mode B · predicate", compactLabel: "Mode B" },
  ];

  return (
    <div
      className={cn(
        "inline-grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-muted/60 p-1",
        compact ? "w-full" : "w-full sm:w-auto",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === activeMode;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => setMode(option.value)}
            className={cn(
              "relative min-h-8 rounded-md px-3 py-1.5 text-sm font-semibold outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active ? "text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`demo-mode-indicator-${switchId}`}
                className={cn("absolute inset-0 rounded-md", MODE_THEME[option.value].solid)}
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-10 whitespace-nowrap">
              <span className={compact ? "hidden min-[360px]:inline" : "hidden sm:inline"}>
                {option.label}
              </span>
              <span className={compact ? "min-[360px]:hidden" : "sm:hidden"}>
                {option.compactLabel}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function resolveMode(value: string | undefined): DemoMode {
  return value === "b" ? "b" : "a";
}
