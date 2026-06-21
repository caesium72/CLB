"use client";

import { ExternalLink, UserCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addressUrl, agentUrl } from "@/lib/explorer";
import {
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_DESCRIPTION,
  ORCHESTRATOR_NAME,
  ORCHESTRATOR_WALLET,
} from "@/lib/orchestrator";
import { cn } from "@/lib/utils";

/** Where "view this agent" points: its 8004scan identity page once minted, else its wallet. */
function orchestratorLink(): { href: string; explorer: "8004scan" | "BaseScan"; registered: boolean } {
  if (ORCHESTRATOR_AGENT_ID) {
    return { href: agentUrl(ORCHESTRATOR_AGENT_ID), explorer: "8004scan", registered: true };
  }
  return { href: addressUrl(ORCHESTRATOR_WALLET), explorer: "BaseScan", registered: false };
}

/** Compact intent-page CTA: the agent that will act on the human's behalf. */
export function OrchestratorCta() {
  const { href, explorer, registered } = orchestratorLink();
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{ORCHESTRATOR_NAME}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This agent acts on your behalf — it shops, authorizes, and settles within the limits you
            set. It has its own on-chain identity on the ERC-8004 registry.
          </p>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "mt-3 gap-1.5",
            )}
          >
            {registered ? `View agent ${ORCHESTRATOR_AGENT_ID ? `#${ORCHESTRATOR_AGENT_ID}` : ""} on ${explorer}` : `View wallet on ${explorer}`}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Full anchor-page identity card for the orchestrator. */
export function OrchestratorIdentityCard() {
  const { href, explorer, registered } = orchestratorLink();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="size-4 text-primary" />
          Your agent's identity
        </CardTitle>
        <CardDescription>
          The buyer-side agent that acted on your behalf has its own ERC-8004 identity — not borrowed
          from a merchant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-semibold">{ORCHESTRATOR_NAME}</p>
          <p className="mt-1 text-xs text-muted-foreground">{ORCHESTRATOR_DESCRIPTION}</p>
        </div>
        <dl className="space-y-2 text-sm">
          {registered ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Agent id</dt>
              <dd className="font-mono text-xs">#{ORCHESTRATOR_AGENT_ID}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Verified wallet</dt>
            <dd className="font-mono text-xs break-all">{ORCHESTRATOR_WALLET}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Metadata</dt>
            <dd className="text-xs text-muted-foreground">
              Self-contained <span className="font-mono">data:application/json</span> URI (no hosted card)
            </dd>
          </div>
        </dl>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        >
          {registered ? `View on ${explorer}` : `View wallet on ${explorer}`}
          <ExternalLink className="size-3.5" />
        </a>
      </CardContent>
    </Card>
  );
}
