"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { OrchestratorCta } from "@/components/orchestrator-identity";
import { useDemoRun } from "@/components/demo-run-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DISCOVERY_COPY, INTENT_COPY, KNOWN_AGENTS } from "@/lib/demo-copy";
import { cn } from "@/lib/utils";

type CreatedIntent = {
  intentId: string;
  task: string;
  input: string;
  budget: string;
  asset: string;
  network: string;
  token: string;
};

const ALL_AGENT_IDS = KNOWN_AGENTS.map((agent) => agent.agentId);

export default function IntentPage() {
  const router = useRouter();
  const { mode, updateRun } = useDemoRun();
  const [created, setCreated] = useState<CreatedIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{
    task: string;
    input: string;
    budget: string;
    asset: string;
    network: string;
    validUntil: string;
  }>({
    task: KNOWN_AGENTS[0]!.example.task,
    input: KNOWN_AGENTS[0]!.example.input,
    budget: "2.00",
    asset: "USDC",
    network: "base-sepolia",
    validUntil: "",
  });
  // Allowed-agents predicate. Default: all allowed (no restriction).
  const [allowed, setAllowed] = useState<Set<string>>(new Set(ALL_AGENT_IDS));

  // Default the predicate deadline to 24h out, set on the client to avoid an SSR
  // hydration mismatch (Date.now() differs between server and client render).
  useEffect(() => {
    if (form.validUntil) return;
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setForm((current) => (current.validUntil ? current : { ...current, validUntil: local }));
  }, [form.validUntil]);

  const update = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  const restriction = useMemo(() => {
    const ids = ALL_AGENT_IDS.filter((id) => allowed.has(id));
    // Empty or "all selected" both mean no restriction.
    return ids.length > 0 && ids.length < ALL_AGENT_IDS.length ? ids : undefined;
  }, [allowed]);

  function toggleAgent(agentId: string) {
    setAllowed((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function loadExample(agentId: string) {
    const agent = KNOWN_AGENTS.find((candidate) => candidate.agentId === agentId);
    if (!agent) return;
    update({ task: agent.example.task, input: agent.example.input });
  }

  async function submitIntent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    updateRun({
      runStatus: "preparing",
      error: undefined,
      traceId: undefined,
      mandateId: undefined,
      discovery: undefined,
      quote: undefined,
      checkoutStage: "idle",
    });
    try {
      // Mode B: send the predicate deadline as a full ISO string (with tz) so the
      // server parses it unambiguously. Mode A (exact cart) ignores it.
      const validUntilIso =
        mode === "b" && form.validUntil && !Number.isNaN(Date.parse(form.validUntil))
          ? new Date(form.validUntil).toISOString()
          : undefined;
      const response = await fetch("/api/demo/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, allowedAgentIds: restriction, validUntil: validUntilIso }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create intent");
      setCreated(payload);
      updateRun({
        intentId: payload.intentId,
        intentToken: payload.token,
        intent: payload,
        runStatus: "ready",
      });
      router.push("/discovery");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Intent creation failed";
      setError(message);
      updateRun({ runStatus: "error", error: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>{INTENT_COPY.title}</CardTitle>
          <CardDescription>{INTENT_COPY.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={(event) => void submitIntent(event)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Try:</span>
              {KNOWN_AGENTS.map((agent) => (
                <Button
                  key={agent.agentId}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => loadExample(agent.agentId)}
                >
                  {agent.name.replace(" Agent", "")} example
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="task">{INTENT_COPY.fields.task.label}</Label>
              <Textarea
                id="task"
                rows={2}
                value={form.task}
                onChange={(event) => update({ task: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.task.help}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="input">{INTENT_COPY.fields.input.label}</Label>
              <Textarea
                id="input"
                rows={2}
                value={form.input}
                onChange={(event) => update({ input: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.input.help}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="budget">{INTENT_COPY.fields.budget.label}</Label>
                <Input
                  id="budget"
                  value={form.budget}
                  onChange={(event) => update({ budget: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.budget.help}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset">{INTENT_COPY.fields.asset.label}</Label>
                <Input
                  id="asset"
                  value={form.asset}
                  onChange={(event) => update({ asset: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.asset.help}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="network">{INTENT_COPY.fields.network.label}</Label>
                <Input
                  id="network"
                  value={form.network}
                  onChange={(event) => update({ network: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.network.help}</p>
              </div>
            </div>

            {mode === "b" ? (
              <div className="space-y-2">
                <Label htmlFor="validUntil">Spending authorization valid until</Label>
                <Input
                  id="validUntil"
                  type="datetime-local"
                  value={form.validUntil}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(event) => update({ validUntil: event.target.value })}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  After this time the delegated spending predicate expires — the agent can no longer
                  pay on your behalf, and any attempted settlement is rejected (rule R17).
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>{INTENT_COPY.fields.allowedAgents.label}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {KNOWN_AGENTS.map((agent) => {
                  const on = allowed.has(agent.agentId);
                  return (
                    <button
                      key={agent.agentId}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleAgent(agent.agentId)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        on
                          ? "border-primary/50 bg-primary/5"
                          : "border-border bg-muted/30 opacity-70 hover:opacity-100",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                      >
                        {on ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{agent.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          #{agent.agentId} · {agent.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{INTENT_COPY.fields.allowedAgents.help}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? INTENT_COPY.submitting : INTENT_COPY.submit}
              </Button>
              {restriction ? (
                <Badge variant="outline">
                  Restricted to {restriction.length} of {ALL_AGENT_IDS.length} agents
                </Badge>
              ) : (
                <Badge variant="secondary">Agent may choose any agent</Badge>
              )}
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {created ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="font-medium">Shopping agent received your task</p>
                <p className="mt-1 text-muted-foreground">{created.task}</p>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <DemoSection title="Acting on your behalf">
          <OrchestratorCta />
        </DemoSection>

        <DemoSection title="What happens next">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-semibold">
              {mode === "b" ? "Delegated spending setup" : "Human-present checkout setup"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {mode === "b"
                ? "You will sign spending limits once; the shopping agent then chooses a concrete allowed payment within them."
                : "You will approve one exact cart payment, and the settlement nonce binds to that exact descriptor."}
            </p>
            <p className="mt-3 text-muted-foreground">{DISCOVERY_COPY.subtitle}</p>
          </div>
        </DemoSection>

        <DemoSection title="Protocol preview">
          <ProtocolPanel
            label="Live intent"
            data={{
              mode,
              intent: created ?? { ...form, allowedAgentIds: restriction ?? "any" },
              next: "POST /api/demo/discover",
            }}
          />
        </DemoSection>
      </div>
    </div>
  );
}
