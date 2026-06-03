"use client";

import { CartQuoteCard } from "@/components/agent/cart-quote-card";
import { DelegationLimitsCard } from "@/components/agent/delegation-limits-card";
import { MandateFormulaPanel } from "@/components/agent/mandate-formula-panel";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { IntentWalletSign } from "@/components/intent-wallet-sign";
import { MandateWalletSign } from "@/components/mandate-wallet-sign";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MANDATE_FORMULAS } from "@/lib/demo-copy";

export default function MandatePage() {
  const { mode, mandateId, traceId, runStatus, error, quote } = useDemoRun();
  const isModeB = mode === "b";
  const formulas = isModeB ? MANDATE_FORMULAS.modeB : MANDATE_FORMULAS.modeA;

  return (
    <StepGate step="mandate">
      <div className="space-y-6">
        <MandateFormulaPanel mode={mode} />

        <div className="grid gap-6 lg:grid-cols-2">
          {quote?.kind === "cart" ? <CartQuoteCard quote={quote} /> : null}
          {quote?.kind === "delegation" ? <DelegationLimitsCard quote={quote} /> : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Authorize payment
                <Badge variant="outline">{isModeB ? "INTENT" : "CART"}</Badge>
              </CardTitle>
              <CardDescription>
                {isModeB
                  ? "Sign spending limits once. Your agent pays on the next step."
                  : "Sign this exact cart. Your agent pays on the next step."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {isModeB ? <IntentWalletSign /> : <MandateWalletSign />}
              {mandateId ? (
                <p className="font-mono text-xs break-all">
                  <span className="text-muted-foreground">Registered mandate: </span>
                  {mandateId}
                </p>
              ) : null}
              {traceId ? (
                <p className="font-mono text-xs break-all">
                  <span className="text-muted-foreground">Live trace: </span>
                  {traceId}
                </p>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </CardContent>
          </Card>
        </div>

        <DemoSection title={isModeB ? "Predicate authorization" : "CLB commitment"}>
          <ProtocolPanel
            label="Mandate signing state"
            data={{
              mode,
              mandateId,
              traceId,
              runStatus,
              title: formulas.title,
              steps: formulas.steps,
              signature: formulas.signature,
            }}
          />
        </DemoSection>
      </div>
    </StepGate>
  );
}
