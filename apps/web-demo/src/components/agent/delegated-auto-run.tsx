"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { friendlyDemoError } from "@/lib/demo-errors";
import { MODE_THEME } from "@/lib/mode-theme";
import { txUrl } from "@/lib/explorer";
import type { DiscoveryResult } from "@/lib/demo-types";
import { cn } from "@/lib/utils";

type StepStatus = "pending" | "active" | "done";
type StepId = "choose" | "authorize" | "settle" | "deliver" | "prove" | "feedback";

const STEP_DEFS: { id: StepId; label: string; activeLabel: string }[] = [
  { id: "choose", label: "Chose an on-chain agent", activeLabel: "Choosing an on-chain agent…" },
  { id: "authorize", label: "Signed your spending rules", activeLabel: "Signing your spending rules…" },
  { id: "settle", label: "Paid within your limits, on-chain", activeLabel: "Paying within your limits…" },
  { id: "deliver", label: "Received the delivered result", activeLabel: "Receiving the result…" },
  { id: "prove", label: "Proved by the deterministic verifier", activeLabel: "Proving with the verifier…" },
  { id: "feedback", label: "Vouched for the merchant on-chain", activeLabel: "Leaving ERC-8004 feedback…" },
];

const ALL_DONE: Record<StepId, StepStatus> = {
  choose: "done",
  authorize: "done",
  settle: "done",
  deliver: "done",
  prove: "done",
  feedback: "done",
};
const ALL_PENDING: Record<StepId, StepStatus> = {
  choose: "pending",
  authorize: "pending",
  settle: "pending",
  deliver: "pending",
  prove: "pending",
  feedback: "pending",
};

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? `${url} failed`);
  return payload as T;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const payload = await res.json();
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? `${url} failed`);
  return payload as T;
}

export function DelegatedAutoRun() {
  const { intentId, intent, traceId, discovery, updateRun } = useDemoRun();
  const theme = MODE_THEME.b;
  const reduce = useReducedMotion();
  const startedRef = useRef(false);
  const [statuses, setStatuses] = useState<Record<StepId, StepStatus>>(() =>
    traceId ? ALL_DONE : ALL_PENDING,
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [predicate, setPredicate] = useState<{ maxValue: string; asset: string } | null>(null);
  const [verdict, setVerdict] = useState<"PASS" | "FAIL" | null>(null);
  const [feedbackUrl, setFeedbackUrl] = useState<string | null>(null);
  const [feedbackScore, setFeedbackScore] = useState<number | null>(null);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(Boolean(traceId));

  // Fresh autonomous run. Runs exactly once via startedRef — note we deliberately
  // do NOT cancel on cleanup: this sequence performs a real on-chain settlement and
  // must complete, and a cleanup-cancel would fight the ref guard under React Strict
  // Mode (dev double-invoke) and hang the checklist. setState after a true unmount is
  // a no-op in React 18; updateRun persists the trace regardless.
  useEffect(() => {
    if (!intentId || traceId || startedRef.current) return;
    startedRef.current = true;
    const set = (id: StepId, status: StepStatus) =>
      setStatuses((current) => ({ ...current, [id]: status }));
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, reduce ? 0 : ms));

    (async () => {
      try {
        // 1 — choose
        set("choose", "active");
        const disc = await postJSON<DiscoveryResult>("/api/demo/discover", { intentId, intent });
        if (disc.selectable === false) {
          throw new Error(disc.rationale || "No on-chain agent fits your rules.");
        }
        updateRun({ discovery: disc });
        const chosen = disc.candidates.find((candidate) => candidate.selected);
        setSelectedAgent(chosen?.card.name ?? disc.selectedMerchantId);
        set("choose", "done");
        await wait(500);

        // 2 — authorize (sign the predicate once)
        set("authorize", "active");
        const prep = await postJSON<{
          predicateDescriptor?: { predicate?: { maxValue?: string; allowedAssets?: string[] } };
          mandateDraft?: unknown;
        }>("/api/demo/prepare", { intentId, intent, mode: "b" });
        const pred = prep.predicateDescriptor?.predicate;
        if (pred?.maxValue) {
          setPredicate({ maxValue: pred.maxValue, asset: pred.allowedAssets?.[0] ?? intent?.asset ?? "" });
        }
        const reg = await postJSON<{ mandateId: string }>("/api/demo/mandates/register", {
          mandateDraft: prep.mandateDraft,
        });
        updateRun({ mandateId: reg.mandateId, quote: undefined });
        set("authorize", "done");
        await wait(500);

        // 3 — settle (real on-chain run)
        set("settle", "active");
        updateRun({ runStatus: "running", checkoutStage: "settling" });
        const trace = await postJSON<{ traceId: string }>("/api/demo/run", {
          intentId,
          intent,
          mandateId: reg.mandateId,
          mode: "b",
        });
        updateRun({ traceId: trace.traceId, runStatus: "live-trace", checkoutStage: "complete" });
        set("settle", "done");
        await wait(500);

        // 4 — deliver
        set("deliver", "active");
        await wait(700);
        set("deliver", "done");
        await wait(300);

        // 5 — prove
        set("prove", "active");
        const cert = await getJSON<{ status?: "PASS" | "FAIL" }>(
          `/api/demo/verify/${encodeURIComponent(trace.traceId)}`,
        );
        setVerdict(cert.status ?? "PASS");
        set("prove", "done");
        await wait(400);

        // 6 — feedback (the agent vouches for the merchant autonomously). Best-effort:
        // a feedback failure must not fail the autonomous run.
        set("feedback", "active");
        try {
          const t = await getJSON<{
            merchantAgent?: { agentId?: string };
            settlement?: { txHash?: string };
            recommendedFeedback?: { score?: number };
          }>(`/api/demo/trace/${encodeURIComponent(trace.traceId)}`);
          const merchantId = t?.merchantAgent?.agentId;
          const derivedScore = t?.recommendedFeedback?.score ?? 90;
          if (merchantId && /^\d+$/.test(String(merchantId))) {
            // Anchor first so the feedbackURI points at the binding proof.
            let feedbackURI = t?.settlement?.txHash ? txUrl(t.settlement.txHash) : undefined;
            try {
              const anchored = await postJSON<{ txHash?: string }>(
                `/api/demo/anchor/${encodeURIComponent(trace.traceId)}`,
                {},
              );
              if (anchored?.txHash) feedbackURI = txUrl(anchored.txHash);
            } catch {
              // keep the settlement-tx fallback
            }
            const fb = await postJSON<{ url?: string }>(
              `/api/demo/feedback/${encodeURIComponent(String(merchantId))}`,
              { score: derivedScore, feedbackURI },
            );
            setFeedbackScore(derivedScore);
            setFeedbackUrl(fb.url ?? null);
          } else {
            setFeedbackNote("Merchant is not a canonical on-chain agent — feedback skipped.");
          }
        } catch (cause) {
          setFeedbackNote(friendlyDemoError(cause, "Feedback skipped"));
        }
        set("feedback", "done");
        setDone(true);
      } catch (cause) {
        setError(friendlyDemoError(cause, "Autonomous run failed"));
        updateRun({ runStatus: "error" });
      }
    })();
  }, [intentId, intent, traceId, reduce, updateRun]);

  // Revisit: a completed trace already exists — hydrate the finished view.
  useEffect(() => {
    if (!traceId || startedRef.current) return;
    if (discovery) {
      const chosen = discovery.candidates.find((candidate) => candidate.selected);
      setSelectedAgent(chosen?.card.name ?? discovery.selectedMerchantId);
    }
    if (!verdict) {
      getJSON<{ status?: "PASS" | "FAIL" }>(`/api/demo/verify/${encodeURIComponent(traceId)}`)
        .then((cert) => setVerdict(cert.status ?? "PASS"))
        .catch(() => undefined);
    }
  }, [traceId, discovery, verdict]);

  return (
    <div className="space-y-6">
      <Card className={cn(theme.accentBorder)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className={cn("size-5", theme.accentText)} />
            Your agent is acting autonomously
          </CardTitle>
          <CardDescription>
            You set the spending rules once. The agent now discovers, authorizes, settles, and proves —
            with no further clicks from you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {STEP_DEFS.map((step) => {
              const status = statuses[step.id];
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    status === "done" && cn(theme.accentBorder, theme.accentBg),
                    status === "active" && "border-border bg-muted/40",
                    status === "pending" && "border-border opacity-50",
                  )}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    {status === "done" ? (
                      <motion.span
                        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      >
                        <Check className={cn("size-4", theme.accentText)} />
                      </motion.span>
                    ) : status === "active" ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      status === "pending" && "text-muted-foreground",
                    )}
                  >
                    {status === "active" ? step.activeLabel : step.label}
                  </span>
                  <AnimatePresence>
                    {step.id === "choose" && selectedAgent && status === "done" ? (
                      <motion.span
                        key="agent"
                        initial={reduce ? false : { opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ml-auto"
                      >
                        <Badge variant="outline">{selectedAgent}</Badge>
                      </motion.span>
                    ) : null}
                    {step.id === "authorize" && predicate && status === "done" ? (
                      <motion.span
                        key="predicate"
                        initial={reduce ? false : { opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ml-auto"
                      >
                        <Badge variant="outline" className="font-mono">
                          ≤ {predicate.maxValue} {predicate.asset}
                        </Badge>
                      </motion.span>
                    ) : null}
                    {step.id === "prove" && verdict && status === "done" ? (
                      <motion.span
                        key="verdict"
                        initial={reduce ? false : { opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ml-auto"
                      >
                        <Badge
                          className={cn(
                            verdict === "PASS"
                              ? "bg-emerald-600 hover:bg-emerald-600"
                              : "bg-destructive hover:bg-destructive",
                          )}
                        >
                          {verdict}
                        </Badge>
                      </motion.span>
                    ) : null}
                    {step.id === "feedback" && status === "done" ? (
                      <motion.span
                        key="feedback"
                        initial={reduce ? false : { opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="ml-auto"
                      >
                        {feedbackUrl ? (
                          <a
                            href={feedbackUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 gap-1.5")}
                          >
                            {feedbackScore ?? 90}/100 · view tx <ArrowRight className="size-3" />
                          </a>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            skipped
                          </Badge>
                        )}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>

          {error ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Link href="/intent" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Edit your rules
              </Link>
            </div>
          ) : null}
          {feedbackNote && !feedbackUrl ? (
            <p className="mt-3 text-xs text-muted-foreground">{feedbackNote}</p>
          ) : null}
        </CardContent>
      </Card>

      {done ? (
        <div className="flex flex-wrap gap-3">
          <Link href="/evidence" className={cn(buttonVariants(), "gap-2")}>
            See the proof <ArrowRight className="size-4" />
          </Link>
          <Link href="/payment" className={buttonVariants({ variant: "outline" })}>
            View receipt
          </Link>
        </div>
      ) : null}
    </div>
  );
}
