"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { agentUrl, txUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";

type FeedbackItem = {
  score: number | null;
  comment: string;
  user: string;
  createdAt: string;
  tags?: string[];
  txHash?: string;
  proofUri?: string;
};
type FeedbackResp = {
  agentId: string;
  count: number;
  averageScore: number | null;
  items: FeedbackItem[];
  error?: string;
};
type FeedbackFactor = { label: string; ok: boolean; detail?: string };
type FeedbackAssessment = {
  score: number;
  status: string;
  rulesPassed: number;
  rulesChecked: number;
  factors: FeedbackFactor[];
};

function when(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function Erc8004FeedbackPanel({
  traceId,
  mode,
}: {
  traceId?: string;
  mode?: "MODE_A_EXACT" | "MODE_B_PREDICATE";
}) {
  const isDelegated = mode === "MODE_B_PREDICATE";
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [settlementTx, setSettlementTx] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<FeedbackAssessment | null>(null);
  // Mode A: the human has the final say — they can override the verifier-derived score.
  const [humanScore, setHumanScore] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState<{ explanation: string; provider: string } | null>(null);
  const [data, setData] = useState<FeedbackResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ url: string; feedbackURI: string | null } | null>(
    null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/trace/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((trace) => {
        if (cancelled) return;
        setAgentId(trace?.merchantAgent?.agentId ?? null);
        setAgentName(trace?.merchantAgent?.card?.name ?? null);
        setSettlementTx(trace?.settlement?.txHash ?? null);
        setAssessment(trace?.recommendedFeedback ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/feedback-reasoning/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        if (typeof payload?.explanation === "string") {
          setReasoning({ explanation: payload.explanation, provider: payload.provider ?? "heuristic" });
        }
        if (payload?.assessment) setAssessment(payload.assessment);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    fetch(`/api/demo/feedback/${encodeURIComponent(agentId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load feedback");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, reload]);

  // Initialize the human slider to the verifier-derived score once it loads.
  useEffect(() => {
    if (assessment && humanScore === null) setHumanScore(assessment.score);
  }, [assessment, humanScore]);

  // Mode A: the human's chosen score wins; Mode B: the agent's derived score stands.
  const effectiveScore = isDelegated
    ? (assessment?.score ?? 90)
    : (humanScore ?? assessment?.score ?? 90);

  async function submitFeedback() {
    if (!agentId) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitResult(null);
    try {
      // Anchor the evidence trace first, then point the feedbackURI at that anchor
      // transaction — the on-chain fingerprint (Merkle root) of the whole interaction,
      // which proves far more than the bare payment. Fall back to the settlement tx
      // only when anchoring is unavailable.
      let feedbackURI = settlementTx ? txUrl(settlementTx) : undefined;
      if (traceId) {
        try {
          const anchorResponse = await fetch(`/api/demo/anchor/${encodeURIComponent(traceId)}`, {
            method: "POST",
          });
          const anchorPayload = await anchorResponse.json();
          if (anchorResponse.ok && typeof anchorPayload?.txHash === "string") {
            feedbackURI = txUrl(anchorPayload.txHash);
          }
        } catch {
          // keep the settlement-tx fallback
        }
      }
      const response = await fetch(`/api/demo/feedback/${encodeURIComponent(agentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: effectiveScore, feedbackURI }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Feedback submission failed");
      setSubmitResult({ url: payload.url, feedbackURI: payload.feedbackURI ?? null });

      // 8004scan's indexer lags behind the on-chain write, so an immediate refetch
      // returns stale data. Optimistically show the feedback we just wrote, then
      // refetch once the indexer has had time to catch up.
      const optimistic: FeedbackItem = {
        score: typeof payload.score === "number" ? payload.score : (assessment?.score ?? 90),
        comment: "",
        user: typeof payload.client === "string" ? payload.client : "client agent",
        createdAt: new Date().toISOString(),
        tags: ["clb-acel", assessment?.status === "PASS" ? "verified" : (assessment?.status ?? "verified")],
        txHash: typeof payload.txHash === "string" ? payload.txHash : undefined,
        proofUri: payload.feedbackURI ?? undefined,
      };
      setData((prev) => {
        const items = [optimistic, ...(prev?.items ?? [])].slice(0, 5);
        const scores = items
          .map((item) => item.score)
          .filter((value): value is number => typeof value === "number");
        const averageScore = scores.length
          ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
          : null;
        return { agentId: agentId!, count: (prev?.count ?? 0) + 1, averageScore, items };
      });
      window.setTimeout(() => setReload((value) => value + 1), 6000);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "Feedback submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!traceId || !agentId) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Star className="size-5 text-primary" />
              Live ERC-8004 reputation
            </CardTitle>
            <CardDescription>
              Real on-chain feedback for {agentName ?? `agent #${agentId}`}, fetched live from 8004scan
              and filtered to this agent.{" "}
              {isDelegated
                ? "In delegated mode your agent vouches autonomously after the job verifies."
                : "Your client agent submits the rating on your behalf (the merchant can't rate itself)."}
            </CardDescription>
          </div>
          <a
            href={agentUrl(agentId)}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1.5")}
          >
            View on 8004scan <ExternalLink className="size-3.5" />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-sm text-muted-foreground">{error ?? "Loading feedback…"}</p>
        ) : data.count > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{data.count} reviews</Badge>
              {data.averageScore != null ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">avg {data.averageScore}/100</Badge>
              ) : null}
            </div>
            <ul className="space-y-2">
              {data.items.map((item, index) => (
                <li
                  key={`${item.user}-${item.createdAt}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-2.5 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    {item.comment ? (
                      <p className="truncate">{item.comment}</p>
                    ) : item.tags && item.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[0.65rem]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No comment</p>
                    )}
                    <p className="font-mono text-[0.7rem] text-muted-foreground">
                      {item.user.slice(0, 12)} · {when(item.createdAt)}
                    </p>
                    {item.txHash ? (
                      <a
                        href={txUrl(item.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        on-chain feedback tx <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </div>
                  {item.score != null ? (
                    <Badge variant="outline" className="shrink-0">
                      {item.score}/100
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No feedback recorded yet for this agent. Leave the first below.
          </p>
        )}

        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {assessment ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">suggested {assessment.score}/100</Badge>
                <span className="text-xs text-muted-foreground">
                  derived from {assessment.rulesPassed}/{assessment.rulesChecked} binding rules
                </span>
              </div>
              {reasoning ? (
                <p className="text-[0.8rem] leading-relaxed">
                  <span className="text-muted-foreground">Why this score ({reasoning.provider}):</span>{" "}
                  {reasoning.explanation}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {assessment.factors.map((factor) => (
                  <Badge
                    key={factor.label}
                    variant="outline"
                    className={factor.ok ? "text-emerald-600" : "text-destructive"}
                  >
                    {factor.ok ? "✓" : "✗"} {factor.label}
                  </Badge>
                ))}
              </div>
              {!isDelegated ? (
                <div className="space-y-1 border-t border-border/60 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="fb-score" className="text-xs font-medium">
                      Your rating — you have the final say
                    </label>
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">{effectiveScore}/100</Badge>
                  </div>
                  <input
                    id="fb-score"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={effectiveScore}
                    onChange={(event) => setHumanScore(Number(event.target.value))}
                    className="w-full accent-primary"
                  />
                  <p className="text-[0.7rem] text-muted-foreground">
                    Starts at the verifier-derived suggestion; drag to set your own score before submitting.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              className="gap-1.5"
              onClick={() => void submitFeedback()}
            >
              <Star className="size-3.5" />
              {submitting
                ? "Submitting on-chain…"
                : isDelegated
                  ? `Agent leaves on-chain feedback (${effectiveScore}/100)`
                  : `Leave on-chain feedback (${effectiveScore}/100)`}
            </Button>
            <span className="text-xs text-muted-foreground">
              Anchors this trace on-chain, then writes a real ERC-8004 feedback transaction whose
              feedbackURI points at that anchor — the binding proof, not just the payment.
            </span>
          </div>
          {submitResult ? (
            <div className="space-y-1">
              <a
                href={submitResult.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-600 underline underline-offset-2"
              >
                Feedback submitted — view the transaction on BaseScan <ExternalLink className="size-3" />
              </a>
              {submitResult.feedbackURI ? (
                <p className="text-[0.7rem] text-muted-foreground">
                  feedbackURI →{" "}
                  <a
                    href={submitResult.feedbackURI}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {submitResult.feedbackURI.includes("/tx/") ? "evidence anchor / settlement tx" : "proof"}
                  </a>{" "}
                  (the on-chain binding proof this rating points at)
                </p>
              ) : null}
            </div>
          ) : null}
          {submitError ? <p className="text-xs text-destructive">{submitError}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
