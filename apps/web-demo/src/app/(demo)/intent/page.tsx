"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Intent = {
  intentId: string;
  task: string;
  token: string;
  budget: string;
  asset: string;
  network: string;
};

export default function IntentPage() {
  const router = useRouter();
  const { mode, updateRun } = useDemoRun();
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    task: "Buy a token-risk report for token XYZ",
    token: "XYZ",
    budget: "2.00",
    asset: "USDC",
    network: "base-sepolia",
  });

  async function submitIntent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    updateRun({ runStatus: "preparing", error: undefined, traceId: undefined, mandateId: undefined, discovery: undefined, quote: undefined, checkoutStage: "idle" });
    try {
      const response = await fetch("/api/demo/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create intent");
      setIntent(payload);
      updateRun({ intentId: payload.intentId, intentToken: payload.token, runStatus: "ready" });
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
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tell your shopping agent</CardTitle>
          <CardDescription>
            Describe what you need. The agent will find a merchant and fetch a quote next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void submitIntent(event)}>
            <div className="space-y-2">
              <Label htmlFor="task">Task</Label>
              <Textarea
                id="task"
                rows={3}
                value={form.task}
                onChange={(event) => setForm((current) => ({ ...current, task: event.target.value }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="token">Token</Label>
                <Input
                  id="token"
                  value={form.token}
                  onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Max budget</Label>
                <Input
                  id="budget"
                  value={form.budget}
                  onChange={(event) => setForm((current) => ({ ...current, budget: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="asset">Allowed asset</Label>
                <Input
                  id="asset"
                  value={form.asset}
                  onChange={(event) => setForm((current) => ({ ...current, asset: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="network">Network</Label>
                <Input
                  id="network"
                  value={form.network}
                  onChange={(event) => setForm((current) => ({ ...current, network: event.target.value }))}
                />
              </div>
            </div>
            <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send to agent"}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {intent ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="font-medium">Shopping Research Agent received your task</p>
                <p className="mt-1 text-muted-foreground">{intent.task}</p>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <DemoSection title="Protocol preview">
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <p className="font-semibold">
            {mode === "b" ? "Delegated spending setup" : "Human-present checkout setup"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {mode === "b"
              ? "You will sign spending limits once; the shopping agent can choose a concrete allowed payment later."
              : "You will approve one exact cart payment, and the nonce binds to that exact settlement descriptor."}
          </p>
        </div>
        <ProtocolPanel
          label="Live intent"
          data={{ mode, intent: intent ?? form, next: "POST /api/demo/prepare" }}
        />
      </DemoSection>
    </div>
  );
}
