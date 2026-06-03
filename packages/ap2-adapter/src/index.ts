import {
  computeCommitment,
  computeMandateDigest,
  signCommitment,
  verifyCommitmentSignature,
} from "@clb-acel/clb-core";
import type {
  CLBCommitmentInput,
  IdentityRef,
  Mandate,
  MandateConstraints,
  PredicateDescriptor,
  SettlementDescriptorExact,
} from "@clb-acel/schemas";
import { MandateSchema } from "@clb-acel/schemas";
import {
  type Address,
  type Hex,
  getAddress,
  recoverMessageAddress,
  verifyMessage,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type MandateType = Mandate["type"];

export type MandateAuthorization = Omit<Mandate, "signature" | "clbCommitment">;

export type IssueMandateInput = {
  type: MandateType;
  authorizedAgent: IdentityRef;
  constraints: MandateConstraints;
  mandateId?: string;
  humanPrincipal?: Address;
  parentMandateHash?: Hex;
  /**
   * CLB binding context. Required for CART and PAYMENT mandates (human-present
   * exact flow); the mandate signature is an EIP-712 signature over the
   * commitment C. Omitted for INTENT mandates.
   */
  clb?: Omit<CLBCommitmentInput, "mandateDigest">;
  /**
   * Delegated (Mode B) spending predicate the human authorizes. Stored on the
   * INTENT mandate constraints via `predicateRef`, with the predicate fields
   * mirrored into the constraints for AP2 compatibility.
   */
  predicate?: PredicateDescriptor;
};

function randomMandateId(type: MandateType): string {
  return `mandate-${type.toLowerCase()}-${crypto.randomUUID()}`;
}

/** Merge a delegated predicate into the mandate constraints (Mode B). */
function constraintsFor(input: IssueMandateInput): MandateConstraints {
  if (!input.predicate) {
    return input.constraints;
  }
  const { predicate, predicateId } = input.predicate;
  const taskHash = input.constraints.taskHash ?? predicate.taskHash;
  return {
    maxAmount: input.constraints.maxAmount ?? predicate.maxValue,
    allowedAssets: input.constraints.allowedAssets ?? predicate.allowedAssets,
    allowedPayees: input.constraints.allowedPayees ?? predicate.allowedPayees,
    validUntil: input.constraints.validUntil ?? predicate.validUntil,
    ...(taskHash ? { taskHash } : {}),
    ...(input.constraints.checkoutHash ? { checkoutHash: input.constraints.checkoutHash } : {}),
    predicateRef: { predicateId },
  };
}

/** Authorization fields that feed both the mandate digest and the CLB commitment. */
function authorizationFields(
  input: IssueMandateInput,
  humanPrincipal: Address,
  mandateId: string,
): MandateAuthorization {
  return {
    mandateId,
    type: input.type,
    humanPrincipal,
    authorizedAgent: input.authorizedAgent,
    constraints: constraintsFor(input),
    ...(input.parentMandateHash ? { parentMandateHash: input.parentMandateHash } : {}),
  };
}

/**
 * Attach a browser-wallet signature to prepared mandate authorization fields.
 * CART/PAYMENT mandates also carry the CLB commitment C that the EIP-712
 * signature covered; INTENT mandates only need the personal-message signature.
 */
export function attachMandateSignature(
  authorization: MandateAuthorization,
  input: { signature: Hex; clbCommitment?: Hex; clb?: CLBCommitmentInput },
): Mandate {
  const mandate = {
    ...authorization,
    ...(input.clbCommitment
      ? { clbCommitment: input.clbCommitment }
      : input.clb
        ? {
            clbCommitment: computeCommitment({
              ...input.clb,
              mandateDigest: computeMandateDigest(authorization as Mandate),
            }),
          }
        : {}),
    signature: input.signature,
  };

  return MandateSchema.parse(mandate);
}

function clbInputFor(
  input: IssueMandateInput,
  authorization: Omit<Mandate, "signature" | "clbCommitment">,
): CLBCommitmentInput {
  if (!input.clb) {
    throw new Error(`CLB binding context is required for ${input.type} mandates`);
  }

  return {
    identityRef: input.clb.identityRef,
    mandateDigest: computeMandateDigest(authorization as Mandate),
    settlementDescriptor: input.clb.settlementDescriptor,
    domain: input.clb.domain,
  };
}

/**
 * Issue an AP2-style mandate. CART/PAYMENT mandates are bound to the CLB
 * commitment C and signed with EIP-712 typed data; INTENT mandates sign over
 * the authorization digest (personal message) and carry no commitment yet.
 */
export async function issueMandate(privateKey: Hex, input: IssueMandateInput): Promise<Mandate> {
  const account = privateKeyToAccount(privateKey);
  const humanPrincipal = input.humanPrincipal ?? account.address;
  const mandateId = input.mandateId ?? randomMandateId(input.type);
  const authorization = authorizationFields(input, humanPrincipal, mandateId);

  if (input.type === "INTENT") {
    const digest = computeMandateDigest(authorization as Mandate);
    const signature = await account.signMessage({ message: { raw: digest } });
    return MandateSchema.parse({ ...authorization, signature });
  }

  const clbInput = clbInputFor(input, authorization);
  const clbCommitment = computeCommitment(clbInput);
  const signature = await signCommitment(privateKey, clbInput);

  return MandateSchema.parse({ ...authorization, clbCommitment, signature });
}

export type VerifyMandateOptions = {
  /** Settlement context to recompute C for CART/PAYMENT mandates. */
  clb?: Omit<CLBCommitmentInput, "mandateDigest">;
  /** Expected human signer; defaults to the mandate's `humanPrincipal`. */
  expectedSigner?: Address;
};

export type VerifyMandateResult = {
  valid: boolean;
  reasons: string[];
  clbCommitment?: Hex;
};

function expectedSignerFor(mandate: Mandate, options: VerifyMandateOptions): Address | null {
  const candidate = options.expectedSigner ?? mandate.humanPrincipal;
  try {
    return getAddress(candidate);
  } catch {
    return null;
  }
}

/** Verify a mandate's signature and (for CART/PAYMENT) its CLB commitment binding. */
export async function verifyMandate(
  mandate: Mandate,
  options: VerifyMandateOptions = {},
): Promise<VerifyMandateResult> {
  const reasons: string[] = [];
  const signer = expectedSignerFor(mandate, options);

  if (!signer) {
    return { valid: false, reasons: ["HUMAN_PRINCIPAL_NOT_AN_ADDRESS"] };
  }

  const authorization = computeMandateDigest(mandate);

  if (mandate.type === "INTENT") {
    const valid = await verifyMessage({
      address: signer,
      message: { raw: authorization },
      signature: mandate.signature as Hex,
    });
    if (!valid) {
      reasons.push("MANDATE_SIGNATURE_INVALID");
    }
    return { valid: reasons.length === 0, reasons };
  }

  if (!mandate.clbCommitment) {
    return { valid: false, reasons: ["CLB_COMMITMENT_MISSING"] };
  }
  if (!options.clb) {
    return { valid: false, reasons: ["CLB_INPUT_REQUIRED"] };
  }

  const clbInput: CLBCommitmentInput = {
    identityRef: options.clb.identityRef,
    mandateDigest: authorization,
    settlementDescriptor: options.clb.settlementDescriptor,
    domain: options.clb.domain,
  };
  const recomputed = computeCommitment(clbInput);

  if (recomputed !== mandate.clbCommitment) {
    reasons.push("CLB_COMMITMENT_MISMATCH");
  }

  const signatureValid = await verifyCommitmentSignature(
    clbInput,
    mandate.signature as Hex,
    signer,
  );
  if (!signatureValid) {
    reasons.push("MANDATE_SIGNATURE_INVALID");
  }

  return { valid: reasons.length === 0, reasons, clbCommitment: recomputed };
}

export async function recoverIntentSigner(mandate: Mandate): Promise<Address> {
  return recoverMessageAddress({
    message: { raw: computeMandateDigest(mandate) },
    signature: mandate.signature as Hex,
  });
}

export type { SettlementDescriptorExact };
