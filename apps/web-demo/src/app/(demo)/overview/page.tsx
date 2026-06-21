import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Coins,
  ExternalLink,
  Fingerprint,
  Link2,
  ListChecks,
  Lock,
  PenLine,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FLOW_LABELS, KNOWN_AGENTS } from "@/lib/demo-copy";
import { demoActs } from "@/lib/demo-nav";
import { CANONICAL_REGISTRY_ADDRESS, agentUrl, registryUrl } from "@/lib/explorer";
import { ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_NAME } from "@/lib/orchestrator";
import { cn } from "@/lib/utils";

/** Headline contributions beyond the commitment itself — each links to where it's shown. */
const CONTRIBUTIONS = [
  {
    icon: Ban,
    title: "Prevented on-chain, not just audited",
    detail:
      "In delegated mode, an over-budget or wrong-payee settlement reverts on Base Sepolia — the predicate guard rejects it before any transfer.",
    href: "/attacks",
    cta: "See it revert",
  },
  {
    icon: Coins,
    title: "Trust the agent economy can price",
    detail:
      "A passing verification becomes an on-chain ERC-8004 validation entry plus reputation feedback — the certificate closes an economic loop, not just a log.",
    href: "/anchor",
    cta: "See the on-chain proof",
  },
  {
    icon: Lock,
    title: "Confidential settlement",
    detail:
      "A commit-and-prove path keeps payee and exact amount off-chain while the predicate still verifies against the public commitment.",
    href: "/privacy",
    cta: "Open the privacy lab",
  },
  {
    icon: ListChecks,
    title: "Deterministic verifier (R1–R17)",
    detail:
      "Every payment is re-checked against C by 17 deterministic rules — no language model in the loop — and the evidence is anchored as a Merkle root you can replay.",
    href: "/verifier",
    cta: "Read the certificate",
  },
] as const;

const LAYERS = [
  {
    icon: Fingerprint,
    name: "Identity",
    protocol: "ERC-8004",
    detail: "Who the agent is — a verifiable on-chain identity and capability card.",
  },
  {
    icon: PenLine,
    name: "Authorization",
    protocol: "AP2 mandate",
    detail: "What the human allowed — an exact cart, or a spending predicate the agent must obey.",
  },
  {
    icon: Coins,
    name: "Payment",
    protocol: "x402",
    detail: "How it settles — a real on-chain payment in response to 402 Payment Required.",
  },
] as const;

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {kicker}
      </p>
      <h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 pb-8">
      {/* Hero */}
      <section className="space-y-5">
        <Badge variant="secondary" className="w-fit">
          Live on Base Sepolia · chain 84532
        </Badge>
        <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Bind identity, authorization, and payment into one provable commitment.
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          Agentic commerce stacks three protocols — who the agent is (ERC-8004), what it may spend
          (AP2), and how it pays (x402). Each is sound on its own, but the seams between them are not.
          CLB-ACEL ties all three with a single cryptographic commitment, then proves every payment
          against it — deterministically, with no language model in the verifier.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link href="/intent" className={cn(buttonVariants(), "gap-2")}>
            Start the walkthrough <ArrowRight className="size-4" />
          </Link>
          <Link href="/attacks" className={buttonVariants({ variant: "outline" })}>
            See the attacks it stops
          </Link>
        </div>
      </section>

      {/* Three layers, one binding */}
      <section className="space-y-5">
        <SectionHeading kicker="The contribution" title="Three layers, one binding" />
        <div className="grid gap-4 lg:grid-cols-3">
          {LAYERS.map((layer) => {
            const Icon = layer.icon;
            return (
              <Card key={layer.name}>
                <CardHeader>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <CardTitle className="mt-3 flex items-center gap-2">
                    {layer.name}
                    <Badge variant="outline" className="font-mono text-xs">
                      {layer.protocol}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{layer.detail}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-5 text-primary" />
              The binding
            </CardTitle>
            <CardDescription className="text-foreground/80">
              <span className="font-mono text-sm">
                C = keccak256( identityRef · mandateDigest · settlementDescriptor )
              </span>{" "}
              and <span className="font-mono text-sm">nonce = H(C)</span> pins one payment to one
              commitment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The thesis in one line: <strong className="text-foreground">single-layer soundness
              does not compose.</strong> A payment rail, a mandate, and an identity can each be
              correct while their combination is exploitable. CLB makes the composition itself
              verifiable — and the Evidence Layer records every step so an auditor can replay it.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Three real identities */}
      <section className="space-y-5">
        <SectionHeading kicker="Not a mock" title="Three real identities, live on-chain" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{ORCHESTRATOR_NAME}</span>
                <Badge variant="outline" className="font-mono">
                  #{ORCHESTRATOR_AGENT_ID}
                </Badge>
              </CardTitle>
              <CardDescription>
                <Badge variant="secondary" className="mb-1.5">Buyer</Badge>
                <br />
                Acts on your behalf — discovers a service, authorizes within your limits, and settles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href={agentUrl(ORCHESTRATOR_AGENT_ID)}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
              >
                View on 8004scan <ExternalLink className="size-3.5" />
              </a>
            </CardContent>
          </Card>
          {KNOWN_AGENTS.map((agent) => (
            <Card key={agent.agentId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{agent.name}</span>
                  <Badge variant="outline" className="font-mono">
                    #{agent.agentId}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  <Badge variant="secondary" className="mb-1.5">Merchant</Badge>
                  <br />
                  {agent.blurb}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={agentUrl(agent.agentId)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
                >
                  View on 8004scan <ExternalLink className="size-3.5" />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          All three are registered in the canonical ERC-8004 Identity Registry{" "}
          <a
            href={registryUrl()}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-foreground underline underline-offset-2"
          >
            {shortenAddress(CANONICAL_REGISTRY_ADDRESS)}
          </a>{" "}
          on Base Sepolia.
        </p>
      </section>

      {/* Two modes */}
      <section className="space-y-5">
        <SectionHeading kicker="The two contributions" title="Two ways to pay" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UserCheck className="size-5" />
              </div>
              <CardTitle className="mt-3">{FLOW_LABELS.modeA.short}</CardTitle>
              <CardDescription>{FLOW_LABELS.modeA.tab}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                You approve one exact cart. The commitment binds the nonce to that precise settlement,
                so the payment cannot be replayed or redirected.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="size-5" />
              </div>
              <CardTitle className="mt-3">{FLOW_LABELS.modeB.short}</CardTitle>
              <CardDescription>{FLOW_LABELS.modeB.tab}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                You sign a spending predicate once. The agent later chooses concrete parameters — and
                a violating settlement <strong className="text-foreground">reverts on-chain</strong>{" "}
                (rule R17 + the predicate guard) before any transfer. Autonomy without a blank cheque.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* What the binding buys you */}
      <section className="space-y-5">
        <SectionHeading kicker="Beyond the commitment" title="What the binding buys you" />
        <div className="grid gap-4 sm:grid-cols-2">
          {CONTRIBUTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="flex flex-col">
                <CardHeader>
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <CardTitle className="mt-3 text-lg">{item.title}</CardTitle>
                  <CardDescription>{item.detail}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link
                    href={item.href}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-2")}
                  >
                    {item.cta} <ArrowRight className="size-3.5" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* IA preview */}
      <section className="space-y-5">
        <SectionHeading kicker="The path ahead" title="How this demo is laid out" />
        <div className="grid gap-4 lg:grid-cols-3">
          {demoActs
            .filter((act) => act.id !== "overview")
            .map((act) => (
              <Card key={act.id}>
                <CardHeader>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    {act.kicker}
                  </p>
                  <CardTitle className="mt-0.5">{act.title}</CardTitle>
                  <CardDescription>{act.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {act.steps.map((step) => {
                      const Icon = step.icon;
                      return (
                        <li key={step.href} className="flex items-center gap-2 text-sm">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{step.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </div>
        <div>
          <Link href="/intent" className={cn(buttonVariants(), "gap-2")}>
            Begin — set the task &amp; rules <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
