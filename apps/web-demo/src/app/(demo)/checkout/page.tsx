"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckoutTimeline } from "@/components/agent/checkout-timeline";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHECKOUT_COPY } from "@/lib/demo-copy";
import { friendlyDemoError } from "@/lib/demo-errors";

export default function CheckoutPage() {
  const router = useRouter();
  const { mode, intentId, intent, mandateId, traceId, intentToken, checkoutStage, updateRun } =
    useDemoRun();
  const [probe402, setProbe402] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = intentToken ?? "XYZ";

  async function agentPays() {
    if (!intentId || !mandateId || traceId) return;
    setBusy(true);
    setError(null);
    setProbe402(null);
    updateRun({ checkoutStage: "probing_402", runStatus: "running", error: undefined });

    try {
      const probeQuery = intentId
        ? `intentId=${encodeURIComponent(intentId)}`
        : `token=${encodeURIComponent(token)}`;
      const probeResponse = await fetch(`/api/demo/probe-402?${probeQuery}`);
      const probePayload = await probeResponse.json();
      if (!probeResponse.ok) throw new Error(probePayload.error ?? "402 probe failed");
      setProbe402(probePayload.paymentRequired as Record<string, unknown>);

      updateRun({ checkoutStage: "settling" });

      const runResponse = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, intent, mandateId, mode }),
      });
      const trace = await runResponse.json();
      if (!runResponse.ok) throw new Error(trace.error ?? "Payment run failed");

      updateRun({
        traceId: trace.traceId,
        checkoutStage: "complete",
        runStatus: "live-trace",
      });
      router.push(`/payment?traceId=${encodeURIComponent(trace.traceId)}`);
    } catch (cause) {
      const message = friendlyDemoError(cause, "Agent checkout failed");
      setError(message);
      updateRun({ checkoutStage: "error", runStatus: "error", error: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepGate step="checkout">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {CHECKOUT_COPY.agentPersona}
              <Badge variant="secondary">Agent acting</Badge>
            </CardTitle>
            <CardDescription>
              {CHECKOUT_COPY.intro}. Click when ready to watch the agent request the report, receive 402, and
              settle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CheckoutTimeline stage={checkoutStage ?? "idle"} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || Boolean(traceId) || !mandateId}
                onClick={() => void agentPays()}
              >
                {traceId ? "Payment complete" : busy ? "Agent paying…" : CHECKOUT_COPY.agentPays}
              </Button>
            </div>
            {mode === "b" ? (
              <p className="text-sm text-muted-foreground">{CHECKOUT_COPY.modeBSettlement}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        {probe402 ? (
          <Card>
            <CardHeader>
              <CardTitle>{CHECKOUT_COPY.probe402}</CardTitle>
              <CardDescription>Live 402 response from the merchant before settlement.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProtocolPanel label="402 Payment Required" data={probe402} />
            </CardContent>
          </Card>
        ) : null}

        <DemoSection title="Checkout state">
          <ProtocolPanel
            label="Session"
            data={{
              intentId,
              mandateId,
              traceId,
              checkoutStage,
              task: intent?.task,
              subject: intent?.input,
            }}
          />
        </DemoSection>
      </div>
    </StepGate>
  );
}
