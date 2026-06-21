"use client";

import { useEffect, useState } from "react";
import { StepContinueButton } from "@/components/agent/step-continue-button";
import { StepGate } from "@/components/agent/step-gate";
import { EvidenceFlowGraph } from "@/components/evidence/evidence-flow-graph";
import { EvidenceMerkleBanner } from "@/components/evidence/evidence-merkle-banner";
import { EvidenceNodeDetail } from "@/components/evidence/evidence-node-detail";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";
import { useResearchMode } from "@/components/research-mode-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvidenceView } from "@/lib/evidence-view";
import type { EvidenceGraphNode } from "@clb-acel/schemas";

export default function EvidencePage() {
  const { traceId } = useDemoRun();
  const { enabled: researchMode } = useResearchMode();
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<EvidenceGraphNode | null>(null);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    fetch(`/api/demo/evidence/${encodeURIComponent(traceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as EvidenceView & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Evidence not found");
        if (!cancelled) {
          setEvidence(payload);
          setSelectedNode(payload.graph.nodes[0] ?? null);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Evidence load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  if (!traceId) {
    return (
      <StepGate step="evidence">
        <span />
      </StepGate>
    );
  }

  if (!evidence) {
    return (
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
        {error ?? "Loading live evidence-service trace..."}
      </p>
    );
  }

  const semanticEdgeCount = evidence.graph.edges.filter((edge) => edge.edgeType !== "BINDS_TO").length;
  const hashEdgeCount = evidence.graph.edges.filter((edge) => edge.edgeType === "BINDS_TO").length;

  return (
    <StepGate step="evidence">
      <>
        <EvidenceMerkleBanner merkleRoot={evidence.merkleRoot} eventCount={evidence.events.length} />

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Cross-protocol evidence graph</CardTitle>
                  <CardDescription>
                    Hash-chain spine plus semantic edges (AUTHORIZES, PAYS_FOR, SETTLES, …) over the live trace.
                  </CardDescription>
                </div>
                <Badge>Live evidence-service</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <EvidenceFlowGraph graph={evidence.graph} onSelectNode={setSelectedNode} />
            </CardContent>
          </Card>

          <EvidenceNodeDetail node={selectedNode} traceId={traceId} />
        </div>

        <div className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trace summary</CardTitle>
              <CardDescription>Tamper-evident hash chain + Merkle root.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <p>
                <span className="text-muted-foreground">Trace ID:</span>{" "}
                <span className="font-mono text-sm break-all">{evidence.traceId}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Nodes:</span> {evidence.graph.nodes.length}
              </p>
              <p>
                <span className="text-muted-foreground">Hash edges:</span> {hashEdgeCount}
              </p>
              <p>
                <span className="text-muted-foreground">Semantic edges:</span> {semanticEdgeCount}
              </p>
            </CardContent>
          </Card>
        </div>

        {researchMode ? (
          <div className="mt-6">
            <DemoSection title="Evidence events">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Object</TableHead>
                    <TableHead>Previous hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.events.map((event) => (
                    <TableRow key={event.eventId}>
                      <TableCell className="font-mono text-xs">{event.eventId}</TableCell>
                      <TableCell>{event.protocol}</TableCell>
                      <TableCell>{event.objectType}</TableCell>
                      <TableCell className="max-w-[18rem] truncate font-mono text-xs">
                        {event.previousEventHash ?? "genesis"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DemoSection>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <StepContinueButton fromStep="evidence" />
        </div>

        {researchMode ? (
          <div className="mt-6">
            <DemoSection title="Protocol object">
              <ProtocolPanel label="EvidenceGraph" data={evidence} />
            </DemoSection>
          </div>
        ) : null}
      </>
    </StepGate>
  );
}
