"use client";

import { ArrowRight, ShoppingCart, UserCheck } from "lucide-react";
import { useResearchMode } from "@/components/research-mode-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Always-visible explainer that orients a general visitor before they pick a
 * tab: which shopping scenario each flow models, and what the attacks prove.
 */
export function AttackPageIntro() {
  const { enabled: research } = useResearchMode();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Two ways to shop — two ways to attack</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          An AI agent can pay on your behalf in two situations. Each tab below runs real attacks
          against one of them and shows whether the binding stack stops the attack.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 @container/intro lg:grid-cols-2">
        <ScenarioCard
          icon={<ShoppingCart className="size-5 text-primary" />}
          heading="You approve each payment"
          subheading={research ? "Human-present checkout · Mode A" : "Human-present checkout"}
          steps={[
            "You review the exact amount, merchant, and token at checkout.",
            "Your signature locks that one payment (a commitment C).",
            "Attacks try to swap the payee, amount, asset, chain, or replay it.",
          ]}
          property={research ? "Proves binding properties P1–P4" : "Proves the payment cannot be tampered with"}
        />
        <ScenarioCard
          icon={<UserCheck className="size-5 text-primary" />}
          heading="You set limits, agent pays"
          subheading={research ? "Agent-delegated spending · Mode B" : "Agent-delegated spending"}
          steps={[
            "You sign spending rules once: merchants, a cap, tokens, a deadline.",
            "The agent later chooses the concrete payment within those rules.",
            "Attacks try to settle outside your rules; the guard should block them.",
          ]}
          property={research ? "Proves predicate soundness (P5)" : "Proves the agent cannot break your rules"}
        />
      </CardContent>
    </Card>
  );
}

function ScenarioCard({
  icon,
  heading,
  subheading,
  steps,
  property,
}: {
  icon: React.ReactNode;
  heading: string;
  subheading: string;
  steps: string[];
  property: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{heading}</p>
          <p className="text-xs text-muted-foreground">{subheading}</p>
        </div>
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 text-sm">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {index + 1}
            </span>
            <span className="leading-relaxed text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <ArrowRight className="size-4 shrink-0 text-primary" />
        <Badge variant="secondary" className="whitespace-normal text-left">
          {property}
        </Badge>
      </div>
    </div>
  );
}
