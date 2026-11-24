import {
  causalHash,
  issueDelegationCertificate,
  verifyCausalExecution,
  ZERO_HASH,
  type CausalCheckCode,
  type CausalVerificationInput,
  type DelegationCertificate,
  type DelegationIdentity,
  type DelegationScope,
} from "@clb-acel/evidence-core";
import { attackerAddress, merchantAddress, registryAddr, shopperAddress } from "./fixtures";

/**
 * Deterministic delegation-DAG fixtures for CDEP. No network, no signing keys
 * and no wall-clock values: identities and artifacts are fixed so the same
 * scenario always produces the same finding codes.
 */

export const CAUSAL_CHAIN_ID = 84532;

export const causalRootAgent: DelegationIdentity = {
  agentId: "root-orchestrator",
  registryAddr,
  chainId: CAUSAL_CHAIN_ID,
  authorizedPaymentKeys: [shopperAddress],
};
export const causalMiddleAgent: DelegationIdentity = {
  agentId: "middle-delegator",
  registryAddr,
  chainId: CAUSAL_CHAIN_ID,
  authorizedPaymentKeys: [shopperAddress],
};
export const causalTerminalAgent: DelegationIdentity = {
  agentId: "terminal-executor",
  registryAddr,
  chainId: CAUSAL_CHAIN_ID,
  authorizedPaymentKeys: [merchantAddress],
};
export const causalAttackerAgent: DelegationIdentity = {
  agentId: "attacker-agent",
  registryAddr,
  chainId: CAUSAL_CHAIN_ID,
  authorizedPaymentKeys: [attackerAddress],
};

export const rootScope: DelegationScope = {
  actions: ["delegate", "analysis.report"],
  assets: ["USDC"],
  allowedPayees: [merchantAddress],
  allowedChainIds: [CAUSAL_CHAIN_ID],
  maxAmount: "2.00",
};
export const terminalScope: DelegationScope = {
  actions: ["analysis.report"],
  assets: ["USDC"],
  allowedPayees: [merchantAddress],
  allowedChainIds: [CAUSAL_CHAIN_ID],
  maxAmount: "1.50",
};

const artifact = (tag: string) => causalHash({ artifact: tag });

export const CAUSAL_ROOT_ID = "cert-root";
export const CAUSAL_MIDDLE_ID = "cert-middle";
export const CAUSAL_TERMINAL_ID = "cert-terminal";

/** The honest three-node DAG: human-authorized root -> delegator -> executor. */
export function buildHonestCausalInput(): CausalVerificationInput {
  const root = issueDelegationCertificate({
    certificateId: CAUSAL_ROOT_ID,
    issuer: causalRootAgent,
    child: causalRootAgent,
    parentExecCommitment: ZERO_HASH,
    action: { actionId: "delegate", targetAgentId: causalRootAgent.agentId, parametersHash: artifact("root-action") },
    policy: { policyId: "policy-root", scope: rootScope },
    inputHash: artifact("root-input"),
    outputHash: artifact("root-output"),
  });
  const middle = issueDelegationCertificate({
    certificateId: CAUSAL_MIDDLE_ID,
    issuer: root.child,
    child: causalMiddleAgent,
    parentCertificateId: root.certificateId,
    parentExecCommitment: root.cExec,
    action: { actionId: "delegate", targetAgentId: causalMiddleAgent.agentId, parametersHash: artifact("middle-action") },
    policy: { policyId: "policy-middle", scope: rootScope },
    inputHash: artifact("middle-input"),
    outputHash: artifact("middle-output"),
  });
  const terminal = issueDelegationCertificate({
    certificateId: CAUSAL_TERMINAL_ID,
    issuer: middle.child,
    child: causalTerminalAgent,
    parentCertificateId: middle.certificateId,
    parentExecCommitment: middle.cExec,
    action: { actionId: "analysis.report", targetAgentId: causalTerminalAgent.agentId, parametersHash: artifact("terminal-action") },
    policy: { policyId: "policy-terminal", scope: terminalScope },
    inputHash: artifact("terminal-input"),
    outputHash: artifact("terminal-output"),
  });

  return {
    certificates: [root, middle, terminal],
    terminalCertificateId: terminal.certificateId,
    executingAgent: causalTerminalAgent,
    settlement: {
      payTo: merchantAddress,
      asset: "USDC",
      value: "1.50",
      chainId: CAUSAL_CHAIN_ID,
      paymentKey: merchantAddress,
    },
    expectedRootExecCommitment: root.cExec,
    expectedTerminalCertificateId: terminal.certificateId,
  };
}

export type CausalScenarioId =
  | "HONEST_DAG"
  | "SUBSTITUTED_INTERMEDIATE_AGENT"
  | "SUBSTITUTED_ACTION"
  | "EXPANDED_DELEGATION"
  | "BROKEN_PARENT_LINK"
  | "SUBSTITUTED_BRANCH"
  | "SUBSTITUTED_PAYEE";

export type CausalScenario = {
  id: CausalScenarioId;
  description: string;
  mutation: string;
  /** Findings that must be present in the verifier output. */
  expectedFindingCodes: CausalCheckCode[];
  input: CausalVerificationInput;
};

function substitutedIntermediateAgent(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  const root = input.certificates[0]!;
  const middle = input.certificates[1]!;
  const terminal = input.certificates[2]!;
  // Reissue the intermediate branch with an attacker as delegatee, and keep the
  // child's C_parent link consistent so only the authority edge is broken.
  const forgedMiddle = issueDelegationCertificate({ ...middle, child: causalAttackerAgent });
  const relinkedTerminal = issueDelegationCertificate({
    ...terminal,
    parentExecCommitment: forgedMiddle.cExec,
  });
  return { ...input, certificates: [root, forgedMiddle, relinkedTerminal] };
}

function substitutedAction(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  const terminal = input.certificates[2]!;
  const forged = issueDelegationCertificate({
    ...terminal,
    action: {
      actionId: terminal.action.actionId,
      targetAgentId: causalAttackerAgent.agentId,
      parametersHash: artifact("attacker-action"),
    },
  });
  return { ...input, certificates: [input.certificates[0]!, input.certificates[1]!, forged] };
}

function expandedDelegation(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  const terminal = input.certificates[2]!;
  const forged = issueDelegationCertificate({
    ...terminal,
    policy: { ...terminal.policy, scope: { ...terminal.policy.scope, maxAmount: "5.00" } },
  });
  return { ...input, certificates: [input.certificates[0]!, input.certificates[1]!, forged] };
}

function brokenParentLink(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  const terminal = input.certificates[2]!;
  const forged = issueDelegationCertificate({
    ...terminal,
    parentExecCommitment: artifact("forged-parent"),
  });
  return { ...input, certificates: [input.certificates[0]!, input.certificates[1]!, forged] };
}

function substitutedBranch(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  const middle = input.certificates[1]!;
  const terminal = input.certificates[2]!;
  // A valid-looking sibling branch is presented while the honest executor and
  // settlement remain unchanged. Branch substitution breaks the trusted anchor
  // and cross-agent attribution.
  const sibling = issueDelegationCertificate({
    ...terminal,
    certificateId: "cert-sibling-attacker",
    child: causalAttackerAgent,
    issuer: middle.child,
    parentCertificateId: middle.certificateId,
    parentExecCommitment: middle.cExec,
    action: { ...terminal.action, targetAgentId: causalAttackerAgent.agentId },
  });
  return { ...input, certificates: [...input.certificates, sibling], terminalCertificateId: sibling.certificateId };
}

function substitutedPayee(): CausalVerificationInput {
  const input = buildHonestCausalInput();
  return { ...input, settlement: { ...input.settlement, payTo: attackerAddress } };
}

export const CAUSAL_SCENARIOS: CausalScenario[] = [
  {
    id: "HONEST_DAG",
    description: "Human-authorized root delegates to an intermediate which delegates to the executing agent; settlement stays inside the terminal scope.",
    mutation: "none",
    expectedFindingCodes: [],
    input: buildHonestCausalInput(),
  },
  {
    id: "SUBSTITUTED_INTERMEDIATE_AGENT",
    description: "An attacker replaces the intermediate delegatee and relinks the child commitment.",
    mutation: "cert-middle.child -> attacker identity; cert-terminal.parentExecCommitment reissued; cert-terminal.issuer left honest",
    expectedFindingCodes: ["PARENT_CHILD_AUTHORITY_MISMATCH"],
    input: substitutedIntermediateAgent(),
  },
  {
    id: "SUBSTITUTED_ACTION",
    description: "The terminal action is replaced by a reissued action attributed to another agent.",
    mutation: "cert-terminal.action.targetAgentId + parametersHash; C_exec reissued",
    expectedFindingCodes: ["ACTION_ATTRIBUTION_MISMATCH"],
    input: substitutedAction(),
  },
  {
    id: "EXPANDED_DELEGATION",
    description: "The terminal branch expands its own spending cap beyond the parent's cap.",
    mutation: "cert-terminal.policy.scope.maxAmount 1.50 -> 5.00; C_exec reissued",
    expectedFindingCodes: ["NON_EXPANDING_DELEGATION_VIOLATED"],
    input: expandedDelegation(),
  },
  {
    id: "BROKEN_PARENT_LINK",
    description: "The terminal certificate points at a parent commitment that was never issued by its parent.",
    mutation: "cert-terminal.parentExecCommitment -> unrelated digest; C_exec reissued",
    expectedFindingCodes: ["PARENT_LINK_MISMATCH"],
    input: brokenParentLink(),
  },
  {
    id: "SUBSTITUTED_BRANCH",
    description: "A sibling branch terminating at the attacker is presented instead of the trusted terminal branch.",
    mutation: "add cert-sibling-attacker under the honest intermediate; terminalCertificateId switched",
    expectedFindingCodes: ["BRANCH_SUBSTITUTION_DETECTED", "CROSS_AGENT_ATTRIBUTION_FAILED"],
    input: substitutedBranch(),
  },
  {
    id: "SUBSTITUTED_PAYEE",
    description: "The settlement payee is routed outside the terminal branch's delegated scope.",
    mutation: "settlement.payTo -> attacker address",
    expectedFindingCodes: ["PAYMENT_EXECUTION_LINEAGE_BROKEN"],
    input: substitutedPayee(),
  },
];

export type CausalScenarioResult = {
  id: CausalScenarioId;
  description: string;
  mutation: string;
  expectedFindingCodes: CausalCheckCode[];
  observedFindingCodes: CausalCheckCode[];
  ok: boolean;
  detected: boolean;
  terminalExecCommitment: string | null;
};

/** Deterministic runner shared by the tests and the experiment artifact. */
export function runCausalScenarios(): CausalScenarioResult[] {
  return CAUSAL_SCENARIOS.map((scenario) => {
    const result = verifyCausalExecution(scenario.input);
    const observedFindingCodes = result.findings.map((finding) => finding.code);
    const expected =
      scenario.expectedFindingCodes.length > 0
        ? scenario.expectedFindingCodes.every((code) => observedFindingCodes.includes(code))
        : result.ok;
    return {
      id: scenario.id,
      description: scenario.description,
      mutation: scenario.mutation,
      expectedFindingCodes: scenario.expectedFindingCodes,
      observedFindingCodes,
      ok: result.ok,
      detected: expected,
      terminalExecCommitment: result.terminalExecCommitment,
    };
  });
}

/** Certificate id lookup helper for callers wiring the DAG into evidence events. */
export function certificateById(
  input: CausalVerificationInput,
  certificateId: string,
): DelegationCertificate | undefined {
  return input.certificates.find((certificate) => certificate.certificateId === certificateId);
}
