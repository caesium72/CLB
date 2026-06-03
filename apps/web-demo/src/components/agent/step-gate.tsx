"use client";

import Link from "next/link";
import { useDemoRun } from "@/components/demo-run-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAccessStep, gateMessage, type DemoStepId } from "@/lib/demo-gates";

export function StepGateEmpty({ step }: { step: DemoStepId }) {
  const run = useDemoRun();
  if (canAccessStep(step, run)) return null;

  const gate = gateMessage(step, run);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{gate.title}</CardTitle>
        <CardDescription>{gate.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={gate.href} className={buttonVariants()}>
          Go back
        </Link>
      </CardContent>
    </Card>
  );
}

export function StepGate({ step, children }: { step: DemoStepId; children: React.ReactNode }) {
  const run = useDemoRun();
  if (!canAccessStep(step, run)) {
    return <StepGateEmpty step={step} />;
  }
  return children;
}
