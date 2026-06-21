"use client";

import { AnchorAction } from "@/components/anchor-action";
import { OnChainProof } from "@/components/on-chain-proof";
import { OrchestratorIdentityCard } from "@/components/orchestrator-identity";
import { StepGate } from "@/components/agent/step-gate";
import { DemoSection, ProtocolPanel } from "@/components/demo-shell";
import { useDemoRun } from "@/components/demo-run-provider";

export default function AnchorPage() {
  const { traceId, mode } = useDemoRun();

  return (
    <StepGate step="anchor">
      <div className="space-y-6">
        <OnChainProof traceId={traceId} />

        <OrchestratorIdentityCard />

        <div className="grid gap-6 lg:grid-cols-2">
          <AnchorAction />
          <DemoSection title="Anchor payload">
            <ProtocolPanel
              label="anchorTrace(traceId, merkleRoot, traceHash, metadataURI)"
              data={{
                traceId,
                mode,
                source: "GET /api/demo/anchor/:traceId/status",
                traceHash: "computeTraceHash({ traceId, merkleRoot, eventHashes })",
                metadataURI: traceId ? `acel://traces/${traceId}` : undefined,
              }}
            />
          </DemoSection>
        </div>
      </div>
    </StepGate>
  );
}
