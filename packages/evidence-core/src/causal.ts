import type { IdentityRef } from "@clb-acel/schemas";
import { keccakCanonical, ZERO_HASH } from "./index";

/**
 * Causal Delegation and Execution Provenance (CDEP).
 *
 * A delegation DAG is a set of certificates. Each certificate binds the branch
 * that authorized it (`C_parent`) to the identity it delegates to (`D_child`),
 * the concrete action (`A_action`), the policy it operates under (`P_policy`),
 * and the input/output artifacts (`H_input`, `H_output`):
 *
 *   C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)
 *
 * H is keccak256 over the canonical JSON encoding of the ordered tuple — the
 * same hash/canonicalization utilities used by the evidence hash chain. All
 * checks below are deterministic and offline; authenticity of the trusted
 * anchors is the caller's responsibility (see verifyCausalExecution docs).
 */

export type CausalHash = `0x${string}`;

/** Delegated agent identity plus the keys that may actually move funds. */
export type DelegationIdentity = IdentityRef & {
  authorizedPaymentKeys: string[];
};

/** Capability envelope inherited along a delegation edge. */
export type DelegationScope = {
  actions: string[];
  assets: string[];
  allowedPayees: string[];
  allowedChainIds: number[];
  /** Human-readable decimal string, e.g. "2.00" (same form as mandate.maxAmount). */
  maxAmount: string;
};

/** P_policy: the policy object whose canonical digest is bound into C_exec. */
export type DelegationPolicy = {
  policyId: string;
  scope: DelegationScope;
};

/** A_action: the concrete action this certificate authorizes. */
export type ActionDescriptor = {
  actionId: string;
  targetAgentId: string;
  parametersHash: CausalHash;
};

/** Fields that are hashed into C_exec. */
export type CausalExecutionInput = {
  parentExecCommitment: CausalHash;
  child: DelegationIdentity;
  action: ActionDescriptor;
  policy: DelegationPolicy;
  inputHash: CausalHash;
  outputHash: CausalHash;
};

/** A signed-off (self-committed) delegation certificate node. */
export type DelegationCertificate = CausalExecutionInput & {
  certificateId: string;
  /** The agent that issued this certificate; must equal the parent's child. */
  issuer: DelegationIdentity;
  /** Absent only for the human-authorized root. */
  parentCertificateId?: string;
  cExec: CausalHash;
};

/** C_exec = keccak256(canonicalJson([C_parent, D_child, A_action, P_policy, H_input, H_output])). */
export function computeCausalExecution(input: CausalExecutionInput): CausalHash {
  return keccakCanonical([
    input.parentExecCommitment, // C_parent
    keccakCanonical(input.child), // D_child
    keccakCanonical(input.action), // A_action
    keccakCanonical(input.policy), // P_policy
    input.inputHash, // H_input
    input.outputHash, // H_output
  ]);
}

/** Issue a certificate by computing and attaching its causal commitment. */
export function issueDelegationCertificate(
  unsigned: Omit<DelegationCertificate, "cExec">,
): DelegationCertificate {
  return { ...unsigned, cExec: computeCausalExecution(unsigned) };
}

/** Settlement facts the final branch must authorize. */
export type CausalSettlement = {
  payTo: string;
  asset: string;
  value: string;
  chainId: number;
  paymentKey: string;
};

export type CausalVerificationInput = {
  certificates: readonly DelegationCertificate[];
  /** Certificate the executing agent claims as its authority branch. */
  terminalCertificateId: string;
  /** Agent actually observed executing the settled task. */
  executingAgent: DelegationIdentity;
  settlement: CausalSettlement;
  /**
   * Trusted anchors. Both MUST come from outside the DAG under test (e.g. a
   * human-signed mandate / branch registry): without them a writer can rebuild
   * a self-consistent DAG and its hashes. Omitted anchors make the corresponding
   * check inapplicable, which is reported as a limitation rather than a PASS.
   */
  expectedRootExecCommitment?: CausalHash;
  expectedTerminalCertificateId?: string;
};

export type CausalCheckCode =
  | "DUPLICATE_CERTIFICATE_ID"
  | "MISSING_ROOT"
  | "MULTIPLE_ROOTS"
  | "ROOT_PARENT_NOT_ZERO"
  | "ROOT_ANCHOR_MISMATCH"
  | "UNKNOWN_TERMINAL_CERTIFICATE"
  | "MISSING_PARENT_CERTIFICATE"
  | "CYCLIC_DELEGATION"
  | "CAUSAL_COMMITMENT_MISMATCH"
  | "PARENT_LINK_MISMATCH"
  | "PARENT_CHILD_AUTHORITY_MISMATCH"
  | "NON_EXPANDING_DELEGATION_VIOLATED"
  | "ACTION_ATTRIBUTION_MISMATCH"
  | "ACTION_NOT_IN_SCOPE"
  | "BRANCH_SUBSTITUTION_DETECTED"
  | "CROSS_AGENT_ATTRIBUTION_FAILED"
  | "PAYMENT_EXECUTION_LINEAGE_BROKEN";

export type CausalFinding = {
  code: CausalCheckCode;
  detail: string;
  certificateId?: string;
};

export type CausalVerificationResult = {
  ok: boolean;
  findings: CausalFinding[];
  /** Recomputed commitments on the root-to-terminal path (not declared values). */
  pathExecCommitments: CausalHash[];
  /** Recomputed commitment of the terminal certificate, or null if unknown. */
  terminalExecCommitment: CausalHash | null;
};

function normalizeAddress(value: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : "";
}

function sameAddress(a: string, b: string): boolean {
  const left = normalizeAddress(a);
  return left !== "" && left === normalizeAddress(b);
}

function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  const left = a.map(normalizeAddress).sort();
  const right = b.map(normalizeAddress).sort();
  return left.length === right.length && left.every((key, index) => key !== "" && key === right[index]);
}

/** Full identity equality, including the payment keys that may move funds. */
export function sameDelegationIdentity(a: DelegationIdentity, b: DelegationIdentity): boolean {
  return (
    a.agentId === b.agentId &&
    sameAddress(a.registryAddr, b.registryAddr) &&
    a.chainId === b.chainId &&
    sameKeySet(a.authorizedPaymentKeys, b.authorizedPaymentKeys)
  );
}

/** Authority chain equality: the agent identity, not its current key set. */
function sameAgent(a: DelegationIdentity, b: DelegationIdentity): boolean {
  return a.agentId === b.agentId && sameAddress(a.registryAddr, b.registryAddr) && a.chainId === b.chainId;
}

function listSubset(child: readonly string[], parent: readonly string[], normalize: (v: string) => string = (v) => v): boolean {
  const allowed = new Set(parent.map(normalize));
  return child.every((entry) => allowed.has(normalize(entry)));
}

function amount(value: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Non-expansion: every capability of the child is contained in the parent's. */
export function scopeIsSubset(child: DelegationScope, parent: DelegationScope): boolean {
  return compareScopes(child, parent).ok;
}

function compareScopes(
  child: DelegationScope,
  parent: DelegationScope,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!listSubset(child.actions, parent.actions)) violations.push("actions");
  if (!listSubset(child.assets, parent.assets)) violations.push("assets");
  if (!listSubset(child.allowedPayees, parent.allowedPayees, normalizeAddress)) violations.push("allowedPayees");
  if (!child.allowedChainIds.every((chain) => parent.allowedChainIds.includes(chain))) {
    violations.push("allowedChainIds");
  }
  const childMax = amount(child.maxAmount);
  const parentMax = amount(parent.maxAmount);
  if (childMax === null || parentMax === null || childMax > parentMax) violations.push("maxAmount");
  return { ok: violations.length === 0, violations };
}

/**
 * Verify a delegation branch from the human-authorized root to the final payee.
 *
 * Proves, over the supplied certificate set: unique ids and a single root;
 * recomputation of every C_exec on the presented path; equality of each
 * `C_parent` with the recomputed parent commitment; parent-child authority;
 * non-expanding delegation; action attribution to the executing agent; the
 * trusted root/terminal branch anchors; and settlement payee/key/asset/value/
 * chain lineage to the terminal branch scope.
 *
 * This engine is offline and deterministic. It does NOT authenticate
 * signatures, read a registry, or fetch anchors: the caller must supply
 * `expectedRootExecCommitment` and `expectedTerminalCertificateId` from a
 * trusted source. Without them a writer who controls every certificate can
 * reissue a self-consistent DAG — the same trust boundary as evidence R1
 * without a trusted Merkle root. Payee/asset/amount/chain checks here are
 * against the *delegation branch scope*, not a replacement for verifier R12
 * (mandate allowlist + registered merchant keys) or R10/R11/R13; both layers
 * should be run on the same settlement.
 */
export function verifyCausalExecution(input: CausalVerificationInput): CausalVerificationResult {
  const findings: CausalFinding[] = [];
  const add = (code: CausalCheckCode, detail: string, certificateId?: string): void => {
    findings.push({ ...(certificateId ? { certificateId } : {}), code, detail });
  };

  const byId = new Map<string, DelegationCertificate>();
  for (const certificate of input.certificates) {
    if (byId.has(certificate.certificateId)) {
      add("DUPLICATE_CERTIFICATE_ID", `Duplicate certificate id ${certificate.certificateId}`, certificate.certificateId);
      continue;
    }
    byId.set(certificate.certificateId, certificate);
  }

  const roots = input.certificates.filter((certificate) => certificate.parentCertificateId === undefined);
  if (roots.length === 0) add("MISSING_ROOT", "Delegation DAG has no root certificate");
  if (roots.length > 1) add("MULTIPLE_ROOTS", `Delegation DAG has ${roots.length} roots`);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (root) {
    if (root.parentExecCommitment !== ZERO_HASH) {
      add("ROOT_PARENT_NOT_ZERO", "Root C_parent is not the zero hash", root.certificateId);
    }
    if (
      input.expectedRootExecCommitment !== undefined &&
      root.cExec !== input.expectedRootExecCommitment
    ) {
      add("ROOT_ANCHOR_MISMATCH", "Root C_exec does not match the trusted root anchor", root.certificateId);
    }
  }

  const terminal = byId.get(input.terminalCertificateId);
  if (!terminal) {
    add("UNKNOWN_TERMINAL_CERTIFICATE", `Unknown terminal certificate ${input.terminalCertificateId}`);
    return { ok: false, findings, pathExecCommitments: [], terminalExecCommitment: null };
  }
  if (
    input.expectedTerminalCertificateId !== undefined &&
    input.terminalCertificateId !== input.expectedTerminalCertificateId
  ) {
    add(
      "BRANCH_SUBSTITUTION_DETECTED",
      `Presented branch ${input.terminalCertificateId} is not the trusted terminal ${input.expectedTerminalCertificateId}`,
      terminal.certificateId,
    );
  }

  // Walk terminal -> root. A revisit is a cycle; a dangling id is a broken DAG.
  const path: DelegationCertificate[] = [];
  const visited = new Set<string>();
  let cursor: DelegationCertificate | undefined = terminal;
  while (cursor) {
    if (visited.has(cursor.certificateId)) {
      add("CYCLIC_DELEGATION", `Delegation cycle at ${cursor.certificateId}`, cursor.certificateId);
      break;
    }
    visited.add(cursor.certificateId);
    path.push(cursor);
    if (cursor.parentCertificateId === undefined) break;
    const parent = byId.get(cursor.parentCertificateId);
    if (!parent) {
      add("MISSING_PARENT_CERTIFICATE", `Parent ${cursor.parentCertificateId} is missing`, cursor.certificateId);
      break;
    }
    cursor = parent;
  }

  const recomputed = new Map<string, CausalHash>();
  for (const certificate of path) {
    const computed = computeCausalExecution(certificate);
    recomputed.set(certificate.certificateId, computed);
    if (computed !== certificate.cExec) {
      add("CAUSAL_COMMITMENT_MISMATCH", "Declared C_exec differs from recomputed commitment", certificate.certificateId);
    }
  }

  for (let index = 0; index < path.length - 1; index += 1) {
    const child = path[index]!;
    const parent = path[index + 1]!;
    if (!sameAgent(child.issuer, parent.child)) {
      add(
        "PARENT_CHILD_AUTHORITY_MISMATCH",
        `Issuer ${child.issuer.agentId} was not delegated authority by parent ${parent.child.agentId}`,
        child.certificateId,
      );
    }
    const expectedParent = recomputed.get(parent.certificateId) ?? parent.cExec;
    if (child.parentExecCommitment !== expectedParent) {
      add("PARENT_LINK_MISMATCH", "C_parent does not equal the recomputed parent C_exec", child.certificateId);
    }
    const scope = compareScopes(child.policy.scope, parent.policy.scope);
    if (!scope.ok) {
      add(
        "NON_EXPANDING_DELEGATION_VIOLATED",
        `Child scope expands parent scope: ${scope.violations.join(", ")}`,
        child.certificateId,
      );
    }
  }

  if (terminal.action.targetAgentId !== terminal.child.agentId) {
    add(
      "ACTION_ATTRIBUTION_MISMATCH",
      `Action targets ${terminal.action.targetAgentId}, not terminal agent ${terminal.child.agentId}`,
      terminal.certificateId,
    );
  }
  if (!terminal.policy.scope.actions.includes(terminal.action.actionId)) {
    add("ACTION_NOT_IN_SCOPE", `Action ${terminal.action.actionId} is outside the terminal policy`, terminal.certificateId);
  }
  if (!sameDelegationIdentity(terminal.child, input.executingAgent)) {
    add(
      "CROSS_AGENT_ATTRIBUTION_FAILED",
      `Observed agent ${input.executingAgent.agentId} is not the terminal delegate ${terminal.child.agentId}`,
      terminal.certificateId,
    );
  }
  if (
    !terminal.child.authorizedPaymentKeys.some((key) => sameAddress(key, input.settlement.paymentKey))
  ) {
    add(
      "CROSS_AGENT_ATTRIBUTION_FAILED",
      `Settlement payment key ${input.settlement.paymentKey} is not authorized by the terminal delegate`,
      terminal.certificateId,
    );
  }

  const scope = terminal.policy.scope;
  const lineage: Array<[boolean, string]> = [
    [scope.allowedPayees.some((payee) => sameAddress(payee, input.settlement.payTo)), "payTo"],
    [scope.assets.includes(input.settlement.asset), "asset"],
    [scope.allowedChainIds.includes(input.settlement.chainId), "chainId"],
  ];
  const settled = amount(input.settlement.value);
  const cap = amount(scope.maxAmount);
  lineage.push([settled !== null && cap !== null && settled <= cap, "value"]);
  for (const [authorized, field] of lineage) {
    if (!authorized) {
      add(
        "PAYMENT_EXECUTION_LINEAGE_BROKEN",
        `Settlement ${field} is not authorized by the terminal branch scope`,
        terminal.certificateId,
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    pathExecCommitments: [...path].reverse().map((certificate) => recomputed.get(certificate.certificateId) ?? certificate.cExec),
    terminalExecCommitment: recomputed.get(terminal.certificateId) ?? terminal.cExec,
  };
}

/** Exposed for callers that want to bind an artifact digest with the same encoding. */
export function causalHash(value: unknown): CausalHash {
  return keccakCanonical(value);
}
