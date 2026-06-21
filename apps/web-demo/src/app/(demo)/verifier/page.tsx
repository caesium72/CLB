"use client";

import { useEffect, useState } from "react";
import { Check, FileCheck2, Link2, ShieldCheck, Star, X } from "lucide-react";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { Erc8004FeedbackPanel } from "@/components/erc8004-feedback";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ruleCopy } from "@/lib/rule-copy";
import { cn } from "@/lib/utils";

type Certificate = {
  traceId: string;
  mode: "MODE_A_EXACT" | "MODE_B_PREDICATE";
  status: "PASS" | "FAIL";
  rulesChecked: string[];
  failedRules: string[];
  clbCommitment: string;
  traceMerkleRoot: string;
  certificateHash: string;
};

const FEEDBACK_STEPS = [
  {
    icon: FileCheck2,
    title: "Verifier certificate",
    detail: "A deterministic PASS/FAIL over R1–R17 — reproducible by anyone, no trust in us.",
  },
  {
    icon: Link2,
    title: "On-chain validation entry",
    detail: "The CrossLayerBindingValidator records the verified trace by its traceId.",
  },
  {
    icon: Star,
    title: "ERC-8004 reputation",
    detail: "A verified outcome becomes priceable trust — feedback the next buyer can rely on.",
  },
];

export default function VerifierPage() {
  const { traceId } = useDemoRun();
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/verify/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Certificate not found");
        if (!cancelled) setCertificate(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Verifier load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  if (!traceId) {
    return (
      <StepGate step="verifier">
        <span />
      </StepGate>
    );
  }

  if (!certificate) {
    return (
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
        {error ?? "Loading verifier certificate…"}
      </p>
    );
  }

  const pass = certificate.status === "PASS";
  const isModeB = certificate.mode === "MODE_B_PREDICATE";

  return (
    <StepGate step="verifier">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Verification result</CardTitle>
                <CardDescription>
                  {isModeB
                    ? "Rules R1–R17, including predicate soundness (R17) for delegated spending."
                    : "Rules R1–R15 for an exact human-present checkout."}
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant="outline">Deterministic · no LLM</Badge>
                <Badge
                  className={pass ? "bg-emerald-600 hover:bg-emerald-600" : "bg-destructive hover:bg-destructive"}
                >
                  {certificate.status}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {certificate.rulesChecked.map((rule) => {
              const ok = !certificate.failedRules.includes(rule);
              return (
                <div
                  key={rule}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-2.5",
                    ok ? "border-border" : "border-destructive/40 bg-destructive/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                      ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className={cn("text-sm", !ok && "font-medium text-destructive")}>{ruleCopy(rule)}</p>
                    <p className="mt-0.5 font-mono text-[0.7rem] text-muted-foreground">{rule}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              What a verified trace unlocks
            </CardTitle>
            <CardDescription>
              The ERC-8004 feedback loop — a PASS becomes on-chain, priceable trust.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {FEEDBACK_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-primary" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{step.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Erc8004FeedbackPanel traceId={traceId} mode={certificate.mode} />

        <div className="flex flex-wrap gap-3">
          <StepContinueButton fromStep="verifier" />
        </div>

        <DemoSection title="Verification certificate">
          <ProtocolPanel label="VerificationCertificate" data={certificate} />
        </DemoSection>
      </div>
    </StepGate>
  );
}
