"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckoutStage } from "@/lib/demo-types";

const STEPS = [
  { id: "probing_402", label: "Request the work", detail: "Merchant returns 402 Payment Required" },
  { id: "settling", label: "Authorize & settle", detail: "Agent signs the payment and settles on-chain" },
  { id: "complete", label: "Delivery", detail: "Signed service report received" },
] as const;

function stageIndex(stage: CheckoutStage): number {
  switch (stage) {
    case "probing_402":
      return 0;
    case "settling":
      return 1;
    case "complete":
      return 2;
    default:
      return -1;
  }
}

export function CheckoutTimeline({ stage }: { stage: CheckoutStage }) {
  const reduce = useReducedMotion();
  const active = stageIndex(stage);

  return (
    <ol className="space-y-2">
      {STEPS.map((step, index) => {
        const done = stage === "complete" || active > index;
        const current = active === index && stage !== "complete";
        const failed = stage === "error" && index === Math.max(active, 0);
        const state = failed ? "failed" : done ? "done" : current ? "current" : "pending";

        return (
          <li
            key={step.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
              state === "done" && "border-primary/30 bg-primary/5",
              state === "current" && "border-primary bg-primary/5",
              state === "failed" && "border-destructive/40 bg-destructive/5",
              state === "pending" && "border-border opacity-50",
            )}
          >
            <span className="flex size-6 shrink-0 items-center justify-center">
              {state === "done" ? (
                <motion.span
                  initial={reduce ? false : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  <Check className="size-4 text-primary" />
                </motion.span>
              ) : state === "current" ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : state === "failed" ? (
                <X className="size-4 text-destructive" />
              ) : (
                <span className="size-2 rounded-full bg-muted-foreground/40" />
              )}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-medium", state === "pending" && "text-muted-foreground")}>
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
