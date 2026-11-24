import { describe, expect, test } from "bun:test";
import {
  causalHash,
  computeCausalExecution,
  issueDelegationCertificate,
  scopeIsSubset,
  verifyCausalExecution,
  ZERO_HASH,
  type CausalHash,
  type CausalVerificationInput,
  type DelegationCertificate,
  type DelegationIdentity,
  type DelegationScope,
} from "../src/index";

const REGISTRY = "0x0000000000000000000000000000000000008004";
const ROOT_KEY = `0x${"1".repeat(40)}`;
const AGENT_KEY = `0x${"2".repeat(40)}`;
const PAYEE = `0x${"3".repeat(40)}`;
const OUTSIDER = `0x${"4".repeat(40)}`;

const rootAgent: DelegationIdentity = {
  agentId: "root-orchestrator",
  registryAddr: REGISTRY,
  chainId: 84532,
  authorizedPaymentKeys: [ROOT_KEY],
};
const middleAgent: DelegationIdentity = {
  agentId: "middle-delegator",
  registryAddr: REGISTRY,
  chainId: 84532,
  authorizedPaymentKeys: [AGENT_KEY],
};
const terminalAgent: DelegationIdentity = {
  agentId: "terminal-executor",
  registryAddr: REGISTRY,
  chainId: 84532,
  authorizedPaymentKeys: [PAYEE],
};
const attackerAgent: DelegationIdentity = {
  agentId: "attacker-agent",
  registryAddr: REGISTRY,
  chainId: 84532,
  authorizedPaymentKeys: [OUTSIDER],
};

const wideScope: DelegationScope = {
  actions: ["delegate", "analysis.report"],
  assets: ["USDC"],
  allowedPayees: [PAYEE],
  allowedChainIds: [84532],
  maxAmount: "2.00",
};
const narrowScope: DelegationScope = {
  actions: ["analysis.report"],
  assets: ["USDC"],
  allowedPayees: [PAYEE],
  allowedChainIds: [84532],
  maxAmount: "1.50",
};
const params = (tag: string): CausalHash => causalHash({ tag });

function buildDag(): { certificates: DelegationCertificate[]; rootId: string; middleId: string; terminalId: string } {
  const rootId = "cert-root";
  const middleId = "cert-middle";
  const terminalId = "cert-terminal";

  const root = issueDelegationCertificate({
    certificateId: rootId,
    issuer: rootAgent,
    child: rootAgent,
    parentExecCommitment: ZERO_HASH,
    action: { actionId: "delegate", targetAgentId: rootAgent.agentId, parametersHash: params("root") },
    policy: { policyId: "policy-root", scope: wideScope },
    inputHash: params("root-input"),
    outputHash: params("root-output"),
  });
  const middle = issueDelegationCertificate({
    certificateId: middleId,
    issuer: root.child,
    child: middleAgent,
    parentCertificateId: rootId,
    parentExecCommitment: root.cExec,
    action: { actionId: "delegate", targetAgentId: middleAgent.agentId, parametersHash: params("middle") },
    policy: { policyId: "policy-middle", scope: wideScope },
    inputHash: params("middle-input"),
    outputHash: params("middle-output"),
  });
  const terminal = issueDelegationCertificate({
    certificateId: terminalId,
    issuer: middle.child,
    child: terminalAgent,
    parentCertificateId: middleId,
    parentExecCommitment: middle.cExec,
    action: { actionId: "analysis.report", targetAgentId: terminalAgent.agentId, parametersHash: params("terminal") },
    policy: { policyId: "policy-terminal", scope: narrowScope },
    inputHash: params("terminal-input"),
    outputHash: params("terminal-output"),
  });
  return { certificates: [root, middle, terminal], rootId, middleId, terminalId };
}

function honestInput(dag = buildDag()): CausalVerificationInput {
  return {
    certificates: dag.certificates,
    terminalCertificateId: dag.terminalId,
    executingAgent: terminalAgent,
    settlement: { payTo: PAYEE, asset: "USDC", value: "1.50", chainId: 84532, paymentKey: PAYEE },
    expectedRootExecCommitment: dag.certificates[0]!.cExec,
    expectedTerminalCertificateId: dag.terminalId,
  };
}

function codes(input: CausalVerificationInput): string[] {
  return verifyCausalExecution(input).findings.map((finding) => finding.code);
}

describe("CDEP commitment", () => {
  test("C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output) is deterministic", () => {
    const dag = buildDag();
    const terminal = dag.certificates[2]!;
    const expected = causalHash([
      terminal.parentExecCommitment,
      causalHash(terminal.child),
      causalHash(terminal.action),
      causalHash(terminal.policy),
      terminal.inputHash,
      terminal.outputHash,
    ]);
    expect(computeCausalExecution(terminal)).toBe(expected);
    expect(computeCausalExecution(terminal)).toBe(terminal.cExec);
    expect(computeCausalExecution(terminal)).toBe(computeCausalExecution(structuredClone(terminal)));
  });

  test("each committed field is bound: changing one changes C_exec", () => {
    const terminal = buildDag().certificates[2]!;
    const original = terminal.cExec;
    const variants: Array<Partial<typeof terminal>> = [
      { parentExecCommitment: params("other-parent") },
      { child: { ...terminalAgent, agentId: "other-agent" } },
      { action: { ...terminal.action, parametersHash: params("other-action") } },
      { policy: { ...terminal.policy, policyId: "other-policy" } },
      { inputHash: params("other-input") },
      { outputHash: params("other-output") },
    ];
    for (const variant of variants) {
      expect(computeCausalExecution({ ...terminal, ...variant })).not.toBe(original);
    }
  });
});

describe("CDEP honest path", () => {
  test("honest root -> middle -> terminal DAG passes all checks", () => {
    const result = verifyCausalExecution(honestInput());
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.pathExecCommitments).toHaveLength(3);
    expect(result.pathExecCommitments[0]).toBe(buildDag().certificates[0]!.cExec);
    expect(result.terminalExecCommitment).toBe(result.pathExecCommitments[2]);
  });
});

describe("CDEP causal trace integrity", () => {
  test("tampering with action, policy, input, output or C_parent without reissuing breaks C_exec", () => {
    const mutations: Array<(certificate: DelegationCertificate) => DelegationCertificate> = [
      (c) => ({ ...c, action: { ...c.action, parametersHash: params("tampered") } }),
      (c) => ({ ...c, policy: { ...c.policy, policyId: "tampered-policy" } }),
      (c) => ({ ...c, inputHash: params("tampered-input") }),
      (c) => ({ ...c, outputHash: params("tampered-output") }),
      (c) => ({ ...c, parentExecCommitment: params("tampered-parent") }),
    ];
    for (const mutate of mutations) {
      const input = honestInput();
      const terminal = mutate(input.certificates[2]!) as DelegationCertificate;
      input.certificates = [input.certificates[0]!, input.certificates[1]!, terminal];
      expect(codes(input)).toContain("CAUSAL_COMMITMENT_MISMATCH");
    }
  });

  test("a reissued certificate with a forged parent link fails the parent-link check", () => {
    const input = honestInput();
    const terminal = input.certificates[2]!;
    const forged = issueDelegationCertificate({
      ...terminal,
      parentExecCommitment: params("forged-parent"),
    });
    input.certificates = [input.certificates[0]!, input.certificates[1]!, forged];
    expect(codes(input)).toContain("PARENT_LINK_MISMATCH");
    expect(codes(input)).not.toContain("CAUSAL_COMMITMENT_MISMATCH");
  });

  test("duplicate ids, missing parent, cycles, multiple roots and unknown terminal fail closed", () => {
    const dag = buildDag();
    const base = honestInput(dag);

    const duplicate = honestInput(dag);
    duplicate.certificates = [...duplicate.certificates, dag.certificates[2]!];
    expect(codes(duplicate)).toContain("DUPLICATE_CERTIFICATE_ID");

    const missing = honestInput(dag);
    missing.certificates = [dag.certificates[0]!, dag.certificates[2]!];
    expect(codes(missing)).toContain("MISSING_PARENT_CERTIFICATE");

    const cyclic = honestInput(dag);
    const loop = issueDelegationCertificate({
      ...dag.certificates[2]!,
      parentCertificateId: dag.terminalId,
      parentExecCommitment: dag.certificates[2]!.cExec,
    });
    cyclic.certificates = [dag.certificates[0]!, dag.certificates[1]!, loop];
    expect(codes(cyclic)).toContain("CYCLIC_DELEGATION");

    const multipleRoots = honestInput(dag);
    multipleRoots.certificates = [
      ...multipleRoots.certificates,
      issueDelegationCertificate({ ...dag.certificates[1]!, certificateId: "another-root", parentCertificateId: undefined }),
    ];
    expect(codes(multipleRoots)).toContain("MULTIPLE_ROOTS");

    const unknown = honestInput(dag);
    unknown.terminalCertificateId = "does-not-exist";
    expect(codes(unknown)).toContain("UNKNOWN_TERMINAL_CERTIFICATE");
    expect(verifyCausalExecution(unknown).terminalExecCommitment).toBeNull();
  });
});

describe("CDEP authority, non-expansion and branch selection", () => {
  test("issuer must be the parent's delegate", () => {
    const input = honestInput();
    const terminal = input.certificates[2]!;
    input.certificates = [
      input.certificates[0]!,
      input.certificates[1]!,
      issueDelegationCertificate({ ...terminal, issuer: attackerAgent }),
    ];
    expect(codes(input)).toContain("PARENT_CHILD_AUTHORITY_MISMATCH");
    expect(codes(input)).not.toContain("PARENT_LINK_MISMATCH");
  });

  test("scope subset is exact on actions, assets, payees, chains and maxAmount", () => {
    expect(scopeIsSubset(narrowScope, wideScope)).toBe(true);
    expect(scopeIsSubset(wideScope, narrowScope)).toBe(false);
    expect(scopeIsSubset({ ...narrowScope, actions: ["payment.transfer"] }, wideScope)).toBe(false);
    expect(scopeIsSubset({ ...narrowScope, assets: ["WETH"] }, wideScope)).toBe(false);
    expect(scopeIsSubset({ ...narrowScope, allowedPayees: [OUTSIDER] }, wideScope)).toBe(false);
    expect(scopeIsSubset({ ...narrowScope, allowedChainIds: [1] }, wideScope)).toBe(false);
    expect(scopeIsSubset({ ...narrowScope, maxAmount: "3.00" }, wideScope)).toBe(false);
    // EIP-55 case differences must not create a false expansion.
    expect(scopeIsSubset({ ...narrowScope, allowedPayees: [PAYEE.toUpperCase().replace("0X", "0x")] }, wideScope)).toBe(true);
  });

  test("a reissued terminal that expands its scope fails non-expansion", () => {
    const input = honestInput();
    const terminal = input.certificates[2]!;
    input.certificates = [
      input.certificates[0]!,
      input.certificates[1]!,
      issueDelegationCertificate({
        ...terminal,
        policy: { ...terminal.policy, scope: { ...narrowScope, maxAmount: "9.00" } },
      }),
    ];
    expect(codes(input)).toContain("NON_EXPANDING_DELEGATION_VIOLATED");
  });

  test("trusted root and terminal anchors catch whole-DAG rewrite and branch substitution", () => {
    const rootAnchor = honestInput();
    rootAnchor.expectedRootExecCommitment = params("wrong-root");
    expect(codes(rootAnchor)).toContain("ROOT_ANCHOR_MISMATCH");

    const branch = honestInput();
    branch.expectedTerminalCertificateId = "another-branch";
    expect(codes(branch)).toContain("BRANCH_SUBSTITUTION_DETECTED");
  });

  test("action must target and belong to the terminal agent", () => {
    const input = honestInput();
    const terminal = input.certificates[2]!;
    input.certificates = [
      input.certificates[0]!,
      input.certificates[1]!,
      issueDelegationCertificate({
        ...terminal,
        action: { ...terminal.action, targetAgentId: attackerAgent.agentId },
      }),
    ];
    expect(codes(input)).toContain("ACTION_ATTRIBUTION_MISMATCH");

    const outOfScope = honestInput();
    const t2 = outOfScope.certificates[2]!;
    outOfScope.certificates = [
      outOfScope.certificates[0]!,
      outOfScope.certificates[1]!,
      issueDelegationCertificate({
        ...t2,
        action: { ...t2.action, actionId: "payment.transfer", targetAgentId: t2.child.agentId },
      }),
    ];
    expect(codes(outOfScope)).toContain("ACTION_NOT_IN_SCOPE");
  });
});

describe("CDEP cross-agent attribution and payment lineage", () => {
  test("observed agent and settlement payment key must match the terminal delegate", () => {
    const wrongAgent = honestInput();
    wrongAgent.executingAgent = attackerAgent;
    expect(codes(wrongAgent)).toContain("CROSS_AGENT_ATTRIBUTION_FAILED");

    const wrongKey = honestInput();
    wrongKey.settlement = { ...wrongKey.settlement, paymentKey: OUTSIDER };
    expect(codes(wrongKey)).toContain("CROSS_AGENT_ATTRIBUTION_FAILED");
  });

  test("settlement payee, asset, chain and value must be authorized by the terminal branch", () => {
    const cases: Array<[Partial<CausalVerificationInput["settlement"]>, string]> = [
      [{ payTo: OUTSIDER }, "payTo"],
      [{ asset: "WETH" }, "asset"],
      [{ chainId: 1 }, "chainId"],
      [{ value: "2.00" }, "value"],
    ];
    for (const [override, field] of cases) {
      const input = honestInput();
      input.settlement = { ...input.settlement, ...override };
      const findings = verifyCausalExecution(input).findings;
      expect(findings.some((finding) => finding.code === "PAYMENT_EXECUTION_LINEAGE_BROKEN" && finding.detail.includes(field))).toBe(true);
    }
  });
});
