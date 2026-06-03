"use client";

import { cn } from "@/lib/utils";
import type { CheckoutStage } from "@/lib/demo-types";

const STEPS = [
  { id: "probing_402", label: "Request report", detail: "Merchant returns 402 Payment Required" },
  { id: "settling", label: "Authorize & settle", detail: "Agent signs payment payload and settles" },
  { id: "complete", label: "Delivery", detail: "Signed token-risk report received" },
] as const;

function stageIndex(stage: CheckoutStage): number {
  switch (stage) {
    case "probing_402":
      return 0;
    case "settling":
      return 1;
    case "complete":
      return 2;
    case "error":
      return -1;
    default:
      return -1;
  }
}

export function CheckoutTimeline({ stage }: { stage: CheckoutStage }) {
  const active = stageIndex(stage);

  return (
    <ol className="space-y-3">
      {STEPS.map((step, index) => {
        const done = active > index || stage === "complete";
        const current = active === index;
        const failed = stage === "error" && index === Math.max(active, 0);

        return (
          <li
            key={step.id}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              done && "border-primary/30 bg-primary/5",
              current && !failed && "border-primary ring-1 ring-primary/20",
              failed && "border-destructive/40 bg-destructive/5",
            )}
          >
            <p className="font-medium">{step.label}</p>
            <p className="text-muted-foreground text-xs">{step.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}
