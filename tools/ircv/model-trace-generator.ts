/**
 * IRCV component 1 — formal-trace generator.
 *
 * Parses the COMMITTED Tamarin artifacts (`formal/tamarin/clb-aligned.spthy`,
 * `.proof`, `.result.txt`). It does NOT run Tamarin and produces NO new proofs:
 * every lemma status is copied from the committed result file and labelled with
 * its provenance.
 */

import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");
export const SPTHY_PATH = resolve(ROOT, "formal/tamarin/clb-aligned.spthy");
export const PROOF_PATH = resolve(ROOT, "formal/tamarin/proofs/clb-aligned.proof");
export const RESULT_PATH = resolve(ROOT, "formal/tamarin/proofs/clb-aligned.result.txt");

export type IrcvEventKind =
  | "principal_anchor"
  | "key_authorization"
  | "predicate_registration"
  | "delegation"
  | "commitment"
  | "nonce"
  | "predicate_decision"
  | "settlement"
  | "settlement_failure"
  | "nonce_consumption"
  | "verification_verdict";

export type IrcvEvent = {
  seq: number;
  /** Tamarin action-fact label, when the event has a model counterpart. */
  label: string;
  kind: IrcvEventKind;
  subject: string;
  bindings: Record<string, string>;
  /** Where the event came from: model rule or a named implementation scenario. */
  origin: string;
};

export type IrcvTrace = {
  schema: "ircv-trace/v1";
  sourceKind: "model" | "implementation";
  sourcePath: string;
  scenarioId: string;
  mode?: "MODE_A_EXACT" | "MODE_B_PREDICATE";
  scenarioKind?: "honest" | "attack" | "out-of-model";
  events: IrcvEvent[];
  notes: string[];
};

export type ModelActionFact = {
  label: string;
  args: string[];
  rule: string;
};

export type ModelRule = {
  name: string;
  actions: ModelActionFact[];
  line: number;
};

export type ModelLemma = {
  name: string;
  quantifier: "all-traces" | "exists-trace";
  formula: string;
  line: number;
  /** Status copied from the committed *.result.txt, never from a fresh proof. */
  committedStatus: "verified" | "not-in-result-file";
  steps?: number;
};

export type PropertyConstraint = {
  id: string;
  lemma: string;
  description: string;
  predicate: string;
};

export type FormalVocabulary = {
  schema: "ircv-formal-vocabulary/v1";
  theory: string;
  sources: { spthy: string; proof: string; result: string };
  toolchainFromCommittedArtifacts: {
    tamarin: string | null;
    maude: string | null;
    note: string;
  };
  rules: ModelRule[];
  actionLabels: string[];
  lemmas: ModelLemma[];
  /** Kinds the model can express; implementation-only kinds are reported separately. */
  modelEventKinds: IrcvEventKind[];
  constraints: PropertyConstraint[];
  ruleTraces: IrcvTrace[];
  warnings: string[];
};

const LABEL_TO_KIND: Record<string, IrcvEventKind> = {
  PrincipalAnchored: "principal_anchor",
  KeyAuthorized: "key_authorization",
  PredicateRegistered: "predicate_registration",
  DelegatedB: "delegation",
  AdmitB: "predicate_decision",
  GuardPassed: "predicate_decision",
  Paid: "settlement",
  SettledB: "settlement",
  FailedSettle: "settlement_failure",
  Consumed: "nonce_consumption",
};

export function kindForLabel(label: string): IrcvEventKind | null {
  if (LABEL_TO_KIND[label]) return LABEL_TO_KIND[label];
  if (label === "Eq") return "commitment";
  return null;
}

/** `Eq` is overloaded in the model: C' equality vs signature-check equality. */
function kindForAction(label: string, args: string[]): IrcvEventKind | null {
  if (label === "Eq" && args[0]?.includes("verify")) return "verification_verdict";
  return kindForLabel(label);
}

/** Split on commas at parenthesis depth 0 (action args can nest, e.g. pk(~sk)). */
function splitTopLevel(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of raw) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function splitArgs(raw: string): string[] {
  return splitTopLevel(raw);
}

function parseActions(block: string): ModelActionFact[] {
  const match = /--\[([\s\S]*?)\]->/.exec(block);
  if (!match?.[1]) return [];
  const actions: ModelActionFact[] = [];
  // The first action shares its line with `--[`, the last one with `]->`.
  const body = match[1].replace(/--\[/g, " ").replace(/\]->/g, " ");
  // Facts may span several lines; split the whole body at top-level commas.
  for (const token of splitTopLevel(body)) {
    const line = token.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!line) continue;
    const fact = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/.exec(line);
    if (fact?.[1] !== undefined) {
      actions.push({ label: fact[1], args: splitArgs(fact[2] ?? ""), rule: "" });
    }
  }
  return actions;
}

/** Parse the model into rules, action vocabulary, lemmas, and trace constraints. */
export function generateFormalVocabulary(
  spthyText: string,
  proofText: string,
  resultText: string,
): FormalVocabulary {
  const theory = /^theory\s+([A-Za-z0-9_]+)/m.exec(spthyText)?.[1] ?? "UNKNOWN";
  const lines = spthyText.split(/\r?\n/);
  const rules: ModelRule[] = [];
  const lemmas: ModelLemma[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const ruleMatch = /^rule\s+([A-Za-z0-9_]+)\s*:/.exec(lines[i] ?? "");
    if (ruleMatch?.[1]) {
      const blockParts: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j] ?? "";
        if (/^rule\s+/.test(candidate) || /^lemma\s+/.test(candidate) || /^end\s*$/.test(candidate)) {
          break;
        }
        blockParts.push(candidate);
      }
      const actions = parseActions(blockParts.join("\n")).map((action) => ({
        ...action,
        rule: ruleMatch[1]!,
      }));
      rules.push({ name: ruleMatch[1], actions, line: i + 1 });
    }

    const lemmaMatch = /^lemma\s+([A-Za-z0-9_]+)\s*:/.exec(lines[i] ?? "");
    if (lemmaMatch?.[1]) {
      let quantifier: ModelLemma["quantifier"] = "all-traces";
      let formula = "";
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        const candidate = (lines[j] ?? "").trim();
        if (candidate === "exists-trace") quantifier = "exists-trace";
        if (candidate === "all-traces") quantifier = "all-traces";
        const quoted = /^"([\s\S]*)"\s*$/.exec(candidate);
        if (quoted?.[1] !== undefined) {
          formula = quoted[1];
          break;
        }
      }
      lemmas.push({ name: lemmaMatch[1], quantifier, formula, line: i + 1, committedStatus: "not-in-result-file" });
    }
  }

  // Copy statuses from the committed result file. No Tamarin process is started.
  for (const lemma of lemmas) {
    const pattern = new RegExp(`^\\s+${lemma.name}\\s+\\((all-traces|exists-trace)\\):\\s+verified \\((\\d+) steps\\)`, "m");
    const found = pattern.exec(resultText);
    if (found) {
      lemma.committedStatus = "verified";
      lemma.steps = Number(found[2]);
    }
  }

  const actionLabels = [...new Set(rules.flatMap((rule) => rule.actions.map((action) => action.label)))].sort();
  const modelEventKinds = [
    ...new Set(rules.flatMap((rule) => rule.actions.map((action) => kindForAction(action.label, action.args)).filter((kind): kind is IrcvEventKind => kind !== null))),
  ].sort();

  const constraints: PropertyConstraint[] = [
    {
      id: "MC-P1",
      lemma: "P1_identity_binding",
      description: "A settlement's paying key must be an authorized key of the same agentId.",
      predicate: "settlement => exists key_authorization(agentId, payer) before settlement",
    },
    {
      id: "MC-P2",
      lemma: "P2_authorization_integrity",
      description: "A settlement must trace to a human delegation with the same commitment and nonce.",
      predicate: "settlement => exists delegation(commitment == settlement.commitment, nonce == settlement.nonce) before settlement",
    },
    {
      id: "MC-P3",
      lemma: "P3_no_replay",
      description: "A nonce may be consumed at most once.",
      predicate: "count(nonce_consumption by nonce) <= 1",
    },
    {
      id: "MC-P4",
      lemma: "P4_non_transferability",
      description: "Settlement fields must equal those the predicate decision admitted.",
      predicate: "settlement => exists predicate_decision(decision == allow, predicateId == settlement.predicateId) before settlement",
    },
    {
      id: "MC-P5",
      lemma: "P5_predicate_soundness",
      description: "The predicate digest bound in the settlement must be the delegated one.",
      predicate: "settlement => delegation.predicateDigest == settlement.predicateDigest",
    },
    {
      id: "MC-P6",
      lemma: "P6_principal_anchor",
      description: "Every settlement traces to an anchored human principal.",
      predicate: "settlement => exists principal_anchor(principal == settlement.principal) before settlement",
    },
  ];

  const ruleTraces: IrcvTrace[] = rules.map((rule, ruleIndex) => ({
    schema: "ircv-trace/v1",
    sourceKind: "model",
    sourcePath: `formal/tamarin/clb-aligned.spthy:rule ${rule.name}`,
    scenarioId: `MODEL_RULE_${rule.name}`,
    events: rule.actions.map((action, actionIndex) => {
      const kind = kindForAction(action.label, action.args);
      return {
        seq: actionIndex + 1,
        label: action.label,
        kind: kind ?? "verification_verdict",
        subject: action.args[0] ?? "",
        bindings: Object.fromEntries(action.args.map((arg, argIndex) => [`arg${argIndex}`, arg])),
        origin: `rule ${rule.name}`,
      };
    }),
    notes: [`Model rule #${ruleIndex + 1}; actions copied from the committed .spthy, not executed.`],
  }));

  const tamarin = /Tamarin version\s+([^\r\n]+)/.exec(proofText)?.[1]?.trim() ?? null;
  const maude = /Maude version\s+([^\r\n]+)/.exec(proofText)?.[1]?.trim() ?? null;
  const warnings = [
    "Tamarin was NOT executed: this generator only parses committed artifacts.",
    "Model vocabulary is Mode B (delegated/predicate) only; Mode A exact traces are outside the model alphabet.",
    "Revocation epochs (RCLB) are absent from clb-aligned.spthy; RCLB scenarios are reported as out-of-model.",
  ];

  return {
    schema: "ircv-formal-vocabulary/v1",
    theory,
    sources: {
      spthy: "formal/tamarin/clb-aligned.spthy",
      proof: "formal/tamarin/proofs/clb-aligned.proof",
      result: "formal/tamarin/proofs/clb-aligned.result.txt",
    },
    toolchainFromCommittedArtifacts: {
      tamarin,
      maude,
      note: "Versions read from the footer of the committed .proof file; no tool was run for this artifact.",
    },
    rules,
    actionLabels,
    lemmas,
    modelEventKinds,
    constraints,
    ruleTraces,
    warnings,
  };
}

export async function loadFormalVocabulary(): Promise<FormalVocabulary> {
  const [spthy, proof, result] = await Promise.all([
    Bun.file(SPTHY_PATH).text(),
    Bun.file(PROOF_PATH).text(),
    Bun.file(RESULT_PATH).text(),
  ]);
  return generateFormalVocabulary(spthy, proof, result);
}
