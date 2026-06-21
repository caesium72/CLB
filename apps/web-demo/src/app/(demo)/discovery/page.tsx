"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { AgentActivityLog } from "@/components/agent/agent-activity-log";
import { DelegatedAutoRun } from "@/components/agent/delegated-auto-run";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DISCOVERY_COPY } from "@/lib/demo-copy";
import type { AgentActivityEvent, AgentVerdict, DiscoveryResult } from "@/lib/demo-types";
import { agentUrl, isOnChainAgentId } from "@/lib/explorer";
import { cn } from "@/lib/utils";

function providerLabel(provider?: string): string | null {
  if (!provider) return null;
  return provider === "heuristic" ? "Heuristic fallback" : `Decided by ${provider}`;
}

export default function DiscoveryPage() {
  const { mode } = useDemoRun();
  if (mode === "b") {
    return (
      <StepGate step="discovery">
        <DelegatedAutoRun />
      </StepGate>
    );
  }
  return <HumanPresentDiscovery />;
}

function HumanPresentDiscovery() {
  const { intentId, intent, discovery, updateRun } = useDemoRun();
  const [result, setResult] = useState<DiscoveryResult | null>(discovery ?? null);
  const [activity, setActivity] = useState<AgentActivityEvent[]>(discovery?.activity ?? []);
  const [visibleCount, setVisibleCount] = useState(discovery?.activity?.length ?? 0);
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
      body: JSON.stringify({ intentId, intent }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Discovery failed");
        if (cancelled) return;

        const mapped: DiscoveryResult = {
          selectedMerchantId: payload.selectedMerchantId,
          selectable: payload.selectable ?? true,
          rationale: payload.rationale,
          llmProvider: payload.llmProvider,
          perAgent: payload.perAgent,
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
        updateRun({ discovery: mapped, runStatus: "ready", error: undefined });
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
  }, [discovery, intent, intentId, updateRun]);

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
  const verdictById = new Map<string, AgentVerdict>(
    (display?.perAgent ?? []).map((verdict) => [verdict.agentId, verdict]),
  );
  const providerText = providerLabel(display?.llmProvider);

  return (
    <StepGate step="discovery">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{DISCOVERY_COPY.title}</CardTitle>
                <CardDescription>{DISCOVERY_COPY.subtitle}</CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant="outline">{DISCOVERY_COPY.decisionLayerBadge}</Badge>
                {providerText ? <Badge variant="secondary">{providerText}</Badge> : null}
              </div>
            </div>
          </CardHeader>
          {busy && !display ? (
            <CardContent>
              <p className="text-sm text-muted-foreground">Your shopping agent is reading both cards…</p>
            </CardContent>
          ) : null}
          {error ? (
            <CardContent>
              <p className="text-sm text-destructive">{error}</p>
            </CardContent>
          ) : null}
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
              {display.candidates.map((candidate) => {
                const verdict = verdictById.get(candidate.agentId);
                const eligible = verdict ? verdict.eligible : candidate.selected;
                const reason = verdict?.reason ?? candidate.rejectedReason ?? display.rationale;
                const selected = display.selectable && candidate.selected;
                return (
                  <Card key={candidate.agentId} className={cn(selected && "border-primary/50")}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate">{candidate.card.name}</span>
                        {selected ? (
                          <Badge>Selected</Badge>
                        ) : eligible ? (
                          <Badge variant="secondary">Eligible</Badge>
                        ) : (
                          <Badge variant="outline">Not eligible</Badge>
                        )}
                      </CardTitle>
                      {candidate.card.description ? (
                        <CardDescription>{candidate.card.description}</CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-start gap-2 text-sm">
                        <span
                          className={cn(
                            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                            eligible
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {eligible ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                        </span>
                        <p className="text-muted-foreground">{reason}</p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="font-mono text-xs text-muted-foreground">#{candidate.agentId}</span>
                        {isOnChainAgentId(candidate.agentId) ? (
                          <a
                            href={agentUrl(candidate.agentId)}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                          >
                            View on 8004scan <ExternalLink className="size-3.5" />
                          </a>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {display.selectable ? (
              <>
                <DemoSection title={DISCOVERY_COPY.reasoningLabel}>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-muted-foreground">
                    {display.rationale}
                  </div>
                </DemoSection>
                <div className="flex flex-wrap items-center gap-3">
                  <StepContinueButton fromStep="discovery" />
                  {!animationDone ? (
                    <span className="text-sm text-muted-foreground">Agent still deciding…</span>
                  ) : null}
                </div>
              </>
            ) : (
              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle>{DISCOVERY_COPY.noneTitle}</CardTitle>
                  <CardDescription>{DISCOVERY_COPY.noneSubtitle}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed">
                    {display.rationale}
                  </div>
                  <Link href="/intent" className={buttonVariants()}>
                    Edit your rules
                  </Link>
                </CardContent>
              </Card>
            )}
          </>
        ) : null}

        <DemoSection title="Discovery payload">
          <ProtocolPanel label="Discovery result" data={display ?? { status: busy ? "loading" : "idle" }} />
        </DemoSection>
      </div>
    </StepGate>
  );
}
