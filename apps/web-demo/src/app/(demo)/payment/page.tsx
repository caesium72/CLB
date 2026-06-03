"use client";

import { useEffect, useState } from "react";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useResearchMode } from "@/components/research-mode-provider";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { friendlyDemoError } from "@/lib/demo-errors";

type Trace = {
  traceId: string;
  mode?: string;
  modeBCommitment?: string;
  settlementDescriptor?: { x402Scheme: string };
  concreteSettlement?: { value: string; asset: string; payTo: string; x402Scheme: string };
  paymentRequirements: { accepts: Array<{ network: string; scheme: string }> };
  paymentPayload: { authorization: { nonce: string } };
  settlement: {
    settled: boolean;
    value: string;
    asset: string;
    payTo: string;
    payer: string;
    nonce: string;
  };
  nonce: string;
};

export default function PaymentPage() {
  const { mode, traceId } = useDemoRun();
  const { enabled: researchMode } = useResearchMode();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setBusy(true);
    });
    fetch(`/api/demo/trace/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Trace not found");
        if (!cancelled) setTrace(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(friendlyDemoError(cause, "Trace load failed"));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  return (
    <StepGate step="payment">
      {busy && !trace ? <p className="text-sm text-muted-foreground">Loading receipt…</p> : null}

      {trace ? (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Payment receipt</CardTitle>
              <CardDescription>
                {mode === "b"
                  ? "The agent settled within your signed limits. Verifier rule R17 checks the predicate."
                  : "Settlement for the cart you authorized. Nonce is bound to CLB commitment C."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-sm">Amount</p>
                <p className="text-lg font-semibold">
                  {trace.settlement.value} {trace.settlement.asset}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Status</p>
                <Badge className="mt-1 bg-emerald-600 hover:bg-emerald-600">
                  {trace.settlement.settled ? "Settled" : "Pending"}
                </Badge>
              </div>
              {mode === "b" && trace.concreteSettlement ? (
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground text-sm">Agent-chosen settlement</p>
                  <p className="font-mono text-xs break-all">
                    {trace.concreteSettlement.value} {trace.concreteSettlement.asset} →{" "}
                    {trace.concreteSettlement.payTo}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Merchant</CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs break-all">{trace.settlement.payTo}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payer agent</CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs break-all">{trace.settlement.payer}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{mode === "b" ? "nonce = H(C′)" : "nonce = H(C)"}</CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs break-all">{trace.nonce}</CardContent>
            </Card>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <StepContinueButton fromStep="payment" />
          </div>

          {researchMode ? (
            <div className="mt-6">
              <DemoSection title="x402 protocol objects">
                <ProtocolPanel
                  label="Payment requirements + payload + settlement"
                  data={{
                    traceId: trace.traceId,
                    modeBCommitment: trace.modeBCommitment,
                    paymentRequirements: trace.paymentRequirements,
                    paymentPayload: trace.paymentPayload,
                    settlement: trace.settlement,
                  }}
                />
              </DemoSection>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      {researchMode && !trace && traceId ? (
        <Button disabled variant="outline">
          Debug: trace loading
        </Button>
      ) : null}
    </StepGate>
  );
}
