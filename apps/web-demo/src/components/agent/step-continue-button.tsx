"use client";

import Link from "next/link";
import { useDemoRun } from "@/components/demo-run-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { canAccessStep, continueLabel, nextStepAfter, stepHref, type DemoStepId } from "@/lib/demo-gates";

export function StepContinueButton({ fromStep }: { fromStep: DemoStepId }) {
  const run = useDemoRun();
  const next = nextStepAfter(fromStep);
  if (!next) return null;

  const enabled = canAccessStep(next, run);
  const href = stepHref(next);
  const label = continueLabel(fromStep, run.mode);

  if (!enabled) {
    return (
      <Button type="button" disabled>
        {label}
      </Button>
    );
  }

  return (
    <Link href={href} className={buttonVariants()}>
      {label}
    </Link>
  );
}
