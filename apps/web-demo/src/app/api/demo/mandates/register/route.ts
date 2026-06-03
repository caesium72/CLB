import { computeCommitment, computeMandateDigest } from "@clb-acel/clb-core";
import type { CLBCommitmentInput, Mandate } from "@clb-acel/schemas";
import { MandateSchema } from "@clb-acel/schemas";
import type { Hex } from "viem";
import { jsonError, proxyJson, readJson, serviceUrls } from "../../_lib";

export async function POST(request: Request) {
  const body = await readJson(request);
  const signature = body.signature;
  const mandateDraft = body.mandateDraft;

  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return jsonError("signature is required");
  }
  if (!mandateDraft || typeof mandateDraft !== "object") {
    return jsonError("mandateDraft is required");
  }

  const clb = body.clb as Omit<CLBCommitmentInput, "mandateDigest"> | undefined;
  const clbCommitment = body.clbCommitment
    ? (body.clbCommitment as Hex)
    : clb
      ? computeCommitment({
          ...clb,
          mandateDigest: computeMandateDigest(mandateDraft as Mandate),
        })
      : undefined;
  const mandate: Mandate = MandateSchema.parse({
    ...(mandateDraft as Omit<Mandate, "signature" | "clbCommitment">),
    ...(clbCommitment ? { clbCommitment } : {}),
    signature,
  });

  return proxyJson(`${serviceUrls.mandate}/mandates/register`, {
    method: "POST",
    body: JSON.stringify({
      mandate,
      ...(body.clb ? { clb: body.clb } : {}),
      ...(body.expectedSigner ? { expectedSigner: body.expectedSigner } : {}),
    }),
  });
}
