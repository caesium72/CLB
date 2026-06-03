"use client";

import { useEffect, useState } from "react";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    return <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{error ?? "Loading verifier certificate..."}</p>;
  }

  const pass = certificate.status === "PASS";

  return (
    <StepGate step="verifier">
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Verification status</CardTitle>
              <CardDescription>
                {certificate.mode === "MODE_B_PREDICATE"
                  ? "Rules R1-R17, including predicate soundness."
                  : "Rules R1-R14 for exact human-present checkout."}
              </CardDescription>
            </div>
            <Badge
              className={pass ? "bg-emerald-600 hover:bg-emerald-600" : "bg-destructive hover:bg-destructive"}
            >
              {certificate.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {certificate.rulesChecked.map((rule) => {
            const ok = !certificate.failedRules.includes(rule);
            return (
              <div key={rule} className="flex items-start gap-2 font-mono text-xs">
                <span className={ok ? "text-emerald-600" : "text-destructive"}>{ok ? "PASS" : "FAIL"}</span>
                <span className={ok ? "text-muted-foreground" : "text-destructive"}>{rule}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <StepContinueButton fromStep="verifier" />
      </div>

      <div className="mt-6">
        <DemoSection title="Verification certificate">
          <ProtocolPanel label="VerificationCertificate" data={certificate} />
        </DemoSection>
      </div>
    </>
    </StepGate>
  );
}
