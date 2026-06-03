"use client";

import { useEffect, useState } from "react";
import { AgentActivityLog } from "@/components/agent/agent-activity-log";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHECKOUT_COPY } from "@/lib/demo-copy";
import type { AgentActivityEvent, DiscoveryResult } from "@/lib/demo-types";

export default function DiscoveryPage() {
  const { intentId, discovery, updateRun } = useDemoRun();
  const [result, setResult] = useState<DiscoveryResult | null>(discovery ?? null);
  const [activity, setActivity] = useState<AgentActivityEvent[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [animationDone, setAnimationDone] = useState(Boolean(discovery));

  useEffect(() => {
    if (!intentId || discovery) return;
    let cancelled = false;
    setBusy(true);
    setError(null);

    fetch("/api/demo/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Discovery failed");
        if (cancelled) return;

        const mapped: DiscoveryResult = {
          selectedMerchantId: payload.selectedMerchantId,
          rationale: payload.rationale,
          activity: payload.activity,
          payerAgent: payload.payerAgent,
          candidates: payload.candidates.map(
            (candidate: {
              agentId: string;
              card: { name: string; description?: string };
              selected: boolean;
              rejectedReason?: string;
            }) => ({
              agentId: candidate.agentId,
              card: candidate.card,
              selected: candidate.selected,
              rejectedReason: candidate.rejectedReason,
            }),
          ),
        };

        setResult(mapped);
        setActivity(mapped.activity);
        updateRun({
          discovery: mapped,
          runStatus: "ready",
          error: undefined,
        });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Discovery failed";
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
  }, [discovery, intentId, updateRun]);

  useEffect(() => {
    if (!activity.length || animationDone) return;

    setVisibleCount(1);
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (let index = 1; index < activity.length; index += 1) {
      const delay = activity[index]!.delayMs - (activity[index - 1]?.delayMs ?? 0);
      timers.push(
        setTimeout(() => {
          setVisibleCount(index + 1);
          if (index === activity.length - 1) setAnimationDone(true);
        }, Math.max(delay, 400)),
      );
    }

    if (activity.length === 1) {
      timers.push(setTimeout(() => setAnimationDone(true), 600));
    }

    return () => timers.forEach(clearTimeout);
  }, [activity, animationDone]);

  const display = result ?? discovery;

  return (
    <StepGate step="discovery">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{CHECKOUT_COPY.agentPersona} is working</CardTitle>
            <CardDescription>
              The shopping agent searches ERC-8004 and picks a merchant that supports x402 settlement.
            </CardDescription>
          </CardHeader>
          {busy && !display ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">Starting agent discovery…</p>
            </CardContent>
          ) : null}
          {error ? <CardContent><p className="text-sm text-destructive">{error}</p></CardContent> : null}
        </Card>

        {display ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Agent activity</CardTitle>
              </CardHeader>
              <CardContent>
                <AgentActivityLog events={display.activity} visibleCount={visibleCount} />
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {display.candidates.map((candidate) => (
                <Card
                  key={candidate.agentId}
                  className={candidate.selected ? "border-primary/50" : undefined}
                >
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {candidate.card.name}
                      {candidate.selected ? (
                        <Badge>Selected</Badge>
                      ) : (
                        <Badge variant="outline">Not selected</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      {candidate.rejectedReason ?? display.rationale}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="font-mono text-xs text-muted-foreground">
                    {candidate.agentId}
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <StepContinueButton fromStep="discovery" />
              {!animationDone ? (
                <span className="text-sm text-muted-foreground">Agent still comparing merchants…</span>
              ) : null}
            </div>
          </>
        ) : null}

        <DemoSection title="Discovery payload">
          <ProtocolPanel label="Discovery result" data={display ?? { status: busy ? "loading" : "idle" }} />
        </DemoSection>
      </div>
    </StepGate>
  );
}
