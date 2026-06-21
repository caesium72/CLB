"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowRight, Bug, Check, Play, Send, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { preventionLayerCopy } from "@/lib/demo-copy";
import { cn } from "@/lib/utils";

type Mutation = { path: string; before: string; after: string; impact: string };

export type RecreatableAttack = {
  attackId: string;
  anatomy: {
    summary: string;
    mutations: Mutation[];
    honestTrace: { settlement: { payTo: string; value: string; asset: string } };
    attackedTrace: { settlement: { payTo: string; value: string; asset: string } };
  };
  preventionLayer: string;
  verification: { result: { status: string; failedRules: string[] } };
};

function attackLabel(id: string): string {
  return id
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function shortAddr(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function Phase({
  runId,
  index,
  reduce,
  children,
}: {
  runId: number;
  index: number;
  reduce: boolean | null;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={`${runId}-${index}`}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : index * 0.6, duration: 0.3 }}
    >
      {children}
    </motion.div>
  );
}

export function AttackRecreation({ result }: { result: RecreatableAttack | null }) {
  const reduce = useReducedMotion();
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (result) setRunId((id) => id + 1);
  }, [result]);

  if (!result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Attack recreation</CardTitle>
          <CardDescription>
            Run an attack to watch it play out end to end: honest payment → injected mutation →
            settlement attempt → caught by a specific rule or layer.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const honest = result.anatomy.honestTrace.settlement;
  const attacked = result.anatomy.attackedTrace.settlement;
  const mutations = result.anatomy.mutations;
  const layer = preventionLayerCopy(result.preventionLayer);
  const failed = result.verification.result.failedRules;
  const caught = result.preventionLayer !== "none";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Recreating {attackLabel(result.attackId)}</CardTitle>
            <CardDescription>{result.anatomy.summary}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setRunId((id) => id + 1)}>
            <Play className="size-3.5" /> Replay
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {/* 1 — honest */}
          <Phase runId={runId} index={0} reduce={reduce}>
            <li className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <Check className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">An honest payment settles normally</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  pay {honest.value} {honest.asset} → {shortAddr(honest.payTo)}
                </p>
              </div>
            </li>
          </Phase>

          {/* 2 — tamper */}
          <Phase runId={runId} index={1} reduce={reduce}>
            <li className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2">
                <Bug className="size-5 shrink-0 text-amber-600" />
                <p className="text-sm font-semibold">The attacker tampers with the trace</p>
              </div>
              <div className="mt-2 space-y-2">
                {mutations.map((mutation) => (
                  <div key={mutation.path} className="rounded-md bg-background p-2 text-xs">
                    <p className="font-mono font-semibold">{mutation.path}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 font-mono">
                      <span className="text-muted-foreground line-through">{mutation.before}</span>
                      <ArrowRight className="size-3 shrink-0" />
                      <span className="font-semibold text-amber-700 dark:text-amber-300">
                        {mutation.after}
                      </span>
                    </p>
                    <p className="mt-1 text-muted-foreground">{mutation.impact}</p>
                  </div>
                ))}
              </div>
            </li>
          </Phase>

          {/* 3 — submit */}
          <Phase runId={runId} index={2} reduce={reduce}>
            <li className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <Send className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">The tampered settlement is submitted</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  pay {attacked.value} {attacked.asset} → {shortAddr(attacked.payTo)}
                </p>
              </div>
            </li>
          </Phase>

          {/* 4 — caught */}
          <Phase runId={runId} index={3} reduce={reduce}>
            <li
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                caught ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
              )}
            >
              <ShieldX
                className={cn("mt-0.5 size-5 shrink-0", caught ? "text-destructive" : "text-muted-foreground")}
              />
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{layer.label}</p>
                  <Badge variant={caught ? "destructive" : "secondary"}>
                    {result.verification.result.status}
                  </Badge>
                </div>
                <p className="mt-0.5 text-muted-foreground">{layer.detail}</p>
                {failed.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {failed.map((rule) => (
                      <Badge key={rule} variant="outline" className="font-mono text-[0.7rem]">
                        {rule}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          </Phase>
        </ol>
      </CardContent>
    </Card>
  );
}
