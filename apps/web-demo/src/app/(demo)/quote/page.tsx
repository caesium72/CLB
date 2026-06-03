"use client";

import { useEffect, useState } from "react";
import { CartQuoteCard } from "@/components/agent/cart-quote-card";
import { DelegationLimitsCard } from "@/components/agent/delegation-limits-card";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QUOTE_COPY } from "@/lib/demo-copy";
import type { DemoQuote } from "@/lib/demo-types";

export default function QuotePage() {
  const { mode, intentId, quote, updateRun } = useDemoRun();
  const [loaded, setLoaded] = useState<DemoQuote | null>(quote ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!intentId || quote) return;
    let cancelled = false;
    setBusy(true);

    fetch("/api/demo/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, mode }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Quote failed");
        if (cancelled) return;
        setLoaded(payload as DemoQuote);
        updateRun({ quote: payload as DemoQuote, runStatus: "ready" });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Quote failed";
        if (!cancelled) {
          setError(message);
          updateRun({ runStatus: "error", error: message });
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [intentId, mode, quote, updateRun]);

  const display = loaded ?? quote;
  const copy = mode === "b" ? QUOTE_COPY.modeB : QUOTE_COPY.modeA;

  return (
    <StepGate step="quote">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.subtitle}</CardDescription>
          </CardHeader>
          {busy && !display ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">Requesting merchant quote…</p>
            </CardContent>
          ) : null}
          {error ? (
            <CardContent>
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          ) : null}
        </Card>

        {display?.kind === "cart" ? <CartQuoteCard quote={display} /> : null}
        {display?.kind === "delegation" ? <DelegationLimitsCard quote={display} /> : null}

        {display ? (
          <div className="flex flex-wrap gap-3">
            <StepContinueButton fromStep="quote" />
          </div>
        ) : null}

        <DemoSection title="Quote payload">
          <ProtocolPanel label="Quote" data={display ?? { status: busy ? "loading" : "idle" }} />
        </DemoSection>
      </div>
    </StepGate>
  );
}
