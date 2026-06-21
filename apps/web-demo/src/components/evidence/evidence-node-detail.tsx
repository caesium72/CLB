"use client";

import { useEffect, useState } from "react";
import type { EvidenceGraphNode } from "@clb-acel/schemas";
import { BrainCircuit, Check, FileCheck2, ShieldCheck, Sparkles, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { protocolColors } from "@/lib/evidence-graph-theme";
import { cn } from "@/lib/utils";

function truncateHash(hash: string | undefined, chars = 10) {
  if (!hash) return "—";
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}`;
}

type DecisionCandidate = { agentId?: string; name?: string; rejected?: boolean; reason?: string | null };

/** Reasoning-aware view for the agent's audit-only selection decision. */
function DecisionContextDetail({ fields }: { fields: Record<string, unknown> }) {
  const candidates = Array.isArray(fields.candidates) ? (fields.candidates as DecisionCandidate[]) : [];
  const selected = typeof fields.selected === "string" ? fields.selected : null;
  const rationale = typeof fields.rationale === "string" ? fields.rationale : null;
  const provider = typeof fields.llmProvider === "string" ? fields.llmProvider : null;
  const scan = typeof fields.promptInjectionScan === "string" ? fields.promptInjectionScan : null;

  return (
    <CardContent className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <BrainCircuit className="size-3" /> Decision layer
        </Badge>
        {provider ? <Badge variant="outline">model: {provider}</Badge> : null}
        <Badge variant="outline" className="text-muted-foreground">audit-only · not enforced</Badge>
      </div>

      {rationale ? (
        <div>
          <p className="mb-1 text-muted-foreground">Why the agent chose this merchant</p>
          <p className="rounded-md border bg-muted/40 p-2 text-[0.8rem] leading-relaxed">{rationale}</p>
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div>
          <p className="mb-1 text-muted-foreground">Candidates considered</p>
          <ul className="space-y-1.5">
            {candidates.map((candidate, index) => {
              const isSelected = candidate.agentId != null && candidate.agentId === selected;
              const rejected = Boolean(candidate.rejected);
              return (
                <li
                  key={`${candidate.agentId ?? candidate.name ?? index}`}
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-2",
                    isSelected
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : rejected
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border",
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {isSelected ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <X className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {candidate.name ?? "Agent"}{" "}
                      <span className="font-mono text-[0.7rem] text-muted-foreground">
                        #{candidate.agentId ?? "—"}
                      </span>
                    </p>
                    <p className="text-[0.75rem] text-muted-foreground">
                      {isSelected ? "Selected" : candidate.reason || "Not selected"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {scan ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
          <span className="text-muted-foreground">Prompt-injection scan</span>
          <Badge
            className={cn(
              scan !== "NONE_DETECTED"
                ? "bg-destructive hover:bg-destructive"
                : "bg-emerald-600 hover:bg-emerald-600",
            )}
          >
            {scan}
          </Badge>
        </div>
      ) : null}
      <p className="text-[0.7rem] text-muted-foreground">
        This is the LLM decision layer, logged as evidence only. The deterministic verifier never reads
        it — soundness comes from R1–R17, not from this reasoning.
      </p>
    </CardContent>
  );
}

/** The actual paid work product the merchant delivered. */
function DeliveredResult({ result }: { result: Record<string, unknown> }) {
  const correctedText = typeof result.correctedText === "string" ? result.correctedText : null;
  const summary = typeof result.summary === "string" ? result.summary : null;
  const issues = Array.isArray(result.issues) ? result.issues : null;
  if (correctedText || summary || issues) {
    return (
      <div className="space-y-2">
        {summary ? (
          <p className="rounded-md border bg-muted/40 p-2 text-[0.8rem] leading-relaxed">{summary}</p>
        ) : null}
        {correctedText ? (
          <div>
            <p className="mb-1 text-muted-foreground">Corrected text</p>
            <p className="rounded-md border bg-muted/40 p-2 text-[0.8rem] leading-relaxed">{correctedText}</p>
          </div>
        ) : null}
        {issues && issues.length > 0 ? (
          <div>
            <p className="mb-1 text-muted-foreground">Issues found ({issues.length})</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[0.8rem]">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={index}>{typeof issue === "string" ? issue : JSON.stringify(issue)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 text-muted-foreground">Result</p>
      <pre className="max-h-44 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10px]">
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}

/** What the merchant agent actually delivered for the payment. */
function DeliveryDetail({ fields }: { fields: Record<string, unknown> }) {
  const service = typeof fields.service === "string" ? fields.service : "report";
  const task = typeof fields.task === "string" ? fields.task : null;
  const modelVersion = typeof fields.modelVersion === "string" ? fields.modelVersion : null;
  const reportHash = typeof fields.reportHash === "string" ? fields.reportHash : undefined;
  const signed = Boolean(fields.signaturePresent);
  const bound = Boolean(fields.boundToSettlement);
  const result =
    fields.result && typeof fields.result === "object"
      ? (fields.result as Record<string, unknown>)
      : null;

  return (
    <CardContent className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <FileCheck2 className="size-3" /> {service} delivery
        </Badge>
        {modelVersion ? <Badge variant="outline">model: {modelVersion}</Badge> : null}
        {signed ? <Badge className="bg-emerald-600 hover:bg-emerald-600">signed</Badge> : null}
        {bound ? <Badge className="bg-emerald-600 hover:bg-emerald-600">bound to payment</Badge> : null}
      </div>
      {task ? <p className="text-muted-foreground">{task}</p> : null}
      {result ? <DeliveredResult result={result} /> : null}
      {reportHash ? (
        <div>
          <p className="text-muted-foreground">Report hash (binds delivery to the paid task — R15)</p>
          <p className="break-all font-mono text-xs">{reportHash}</p>
        </div>
      ) : null}
      <p className="text-[0.7rem] text-muted-foreground">
        The signed work product, produced by the merchant&apos;s agent key and bound to the settlement that
        paid for it (R14b).
      </p>
    </CardContent>
  );
}

/** Deterministic verifier verdict over the trace (R1–R17). */
function VerificationDetail({ fields }: { fields: Record<string, unknown> }) {
  const status = typeof fields.status === "string" ? fields.status : "—";
  const rulesPassed = typeof fields.rulesPassed === "number" ? fields.rulesPassed : null;
  const rulesChecked = typeof fields.rulesChecked === "number" ? fields.rulesChecked : null;
  const failed = Array.isArray(fields.failedRules) ? (fields.failedRules as string[]) : [];
  const pass = status === "PASS";

  return (
    <CardContent className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={cn(pass ? "bg-emerald-600 hover:bg-emerald-600" : "bg-destructive hover:bg-destructive")}
        >
          <ShieldCheck className="mr-1 size-3" /> {status}
        </Badge>
        {rulesPassed != null && rulesChecked != null ? (
          <Badge variant="outline">
            {rulesPassed}/{rulesChecked} rules passed
          </Badge>
        ) : null}
        <Badge variant="outline" className="text-muted-foreground">
          deterministic · no LLM
        </Badge>
      </div>
      {failed.length > 0 ? (
        <div>
          <p className="mb-1 text-muted-foreground">Failed rules</p>
          <ul className="space-y-0.5 font-mono text-[0.7rem] text-destructive">
            {failed.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[0.7rem] text-muted-foreground">
        The verifier recomputes R1–R17 over the trace. This verdict is computed off-chain and is not part
        of the Merkle root.
      </p>
    </CardContent>
  );
}

type FeedbackFactor = { label: string; ok: boolean; detail?: string };

/** ERC-8004 reputation: deterministic score + LLM-written reasoning. */
function FeedbackDetail({ fields, traceId }: { fields: Record<string, unknown>; traceId?: string }) {
  const score = typeof fields.score === "number" ? fields.score : null;
  const status = typeof fields.status === "string" ? fields.status : null;
  const rulesPassed = typeof fields.rulesPassed === "number" ? fields.rulesPassed : null;
  const rulesChecked = typeof fields.rulesChecked === "number" ? fields.rulesChecked : null;
  const factors = Array.isArray(fields.factors) ? (fields.factors as FeedbackFactor[]) : [];
  const [prose, setProse] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/demo/feedback-reasoning/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        setProse(typeof payload?.explanation === "string" ? payload.explanation : null);
        setProvider(typeof payload?.provider === "string" ? payload.provider : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  return (
    <CardContent className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Star className="size-3" /> Reputation
        </Badge>
        {score != null ? (
          <Badge className="bg-emerald-600 text-sm hover:bg-emerald-600">{score}/100</Badge>
        ) : null}
        {status ? <Badge variant="outline">{status}</Badge> : null}
      </div>
      <div>
        <p className="mb-1 flex items-center gap-1 text-muted-foreground">
          <Sparkles className="size-3" /> Why this score{provider ? ` (${provider})` : ""}
        </p>
        <p className="rounded-md border bg-muted/40 p-2 text-[0.8rem] leading-relaxed">
          {loading ? "Generating reasoning…" : (prose ?? "Score derived from the verifier outcome below.")}
        </p>
      </div>
      {factors.length > 0 ? (
        <div>
          <p className="mb-1 text-muted-foreground">
            Score basis
            {rulesPassed != null && rulesChecked != null
              ? ` — ${rulesPassed}/${rulesChecked} binding checks`
              : ""}
          </p>
          <ul className="space-y-1.5">
            {factors.map((factor, index) => (
              <li
                key={index}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2",
                  factor.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5",
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {factor.ok ? (
                    <Check className="size-3.5 text-emerald-600" />
                  ) : (
                    <X className="size-3.5 text-destructive" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{factor.label}</p>
                  {factor.detail ? (
                    <p className="text-[0.75rem] text-muted-foreground">{factor.detail}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-[0.7rem] text-muted-foreground">
        The score is deterministic (fraction of binding rules passed); only this explanation is LLM-written.
        Reputation is recorded downstream of the anchor, so it is not inside the trace&apos;s Merkle root.
      </p>
    </CardContent>
  );
}

const FRIENDLY_TITLE: Partial<Record<string, string>> = {
  DECISION_CONTEXT: "Agent decision",
  DELIVERY_PROOF: "Delivered work",
  VERIFICATION_CERTIFICATE: "Verifier verdict",
  ERC8004_FEEDBACK: "Reputation feedback",
};

export function EvidenceNodeDetail({
  node,
  traceId,
}: {
  node: EvidenceGraphNode | null;
  traceId?: string;
}) {
  if (!node) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-base">Node detail</CardTitle>
          <CardDescription>Select a node in the graph to inspect its evidence fields.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const colors = protocolColors(node.protocol);
  const metadata = node.metadata ?? {};
  const publicFields = metadata.publicFields as Record<string, unknown> | undefined;
  const fields = publicFields ?? {};
  const richDetail =
    node.nodeType === "DECISION_CONTEXT" ? (
      <DecisionContextDetail fields={fields} />
    ) : node.nodeType === "DELIVERY_PROOF" ? (
      <DeliveryDetail fields={fields} />
    ) : node.nodeType === "VERIFICATION_CERTIFICATE" ? (
      <VerificationDetail fields={fields} />
    ) : node.nodeType === "ERC8004_FEEDBACK" ? (
      <FeedbackDetail fields={fields} traceId={traceId} />
    ) : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {FRIENDLY_TITLE[node.nodeType] ?? node.label.replace(/_/g, " ")}
            </CardTitle>
            <CardDescription className="font-mono text-xs">{node.id}</CardDescription>
          </div>
          <Badge variant="outline" className={colors.text}>
            {node.protocol}
          </Badge>
        </div>
      </CardHeader>
      {richDetail ?? (
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-muted-foreground">Node type</p>
          <p className="font-mono text-xs">{node.nodeType}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Object hash</p>
          <p className="break-all font-mono text-xs">{node.objectHash ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Event hash</p>
          <p className="break-all font-mono text-xs">{truncateHash(metadata.eventHash as string | undefined, 14)}</p>
        </div>
        {metadata.previousEventHash ? (
          <div>
            <p className="text-muted-foreground">Previous event hash</p>
            <p className="break-all font-mono text-xs">{truncateHash(metadata.previousEventHash as string, 14)}</p>
          </div>
        ) : null}
        <div>
          <p className="text-muted-foreground">Actor</p>
          <p className="break-all font-mono text-xs">{(metadata.actor as string) ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Timestamp</p>
          <p className="font-mono text-xs">{(metadata.timestamp as string) ?? "—"}</p>
        </div>
        {publicFields && Object.keys(publicFields).length > 0 ? (
          <div>
            <p className="mb-1 text-muted-foreground">Public fields</p>
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10px]">
              {JSON.stringify(publicFields, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
      )}
    </Card>
  );
}
