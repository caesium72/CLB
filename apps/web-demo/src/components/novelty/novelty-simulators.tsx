"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Browser-only DEMO simulations for the five novelties.
 * These are illustrative state machines driven by local React state. They do NOT
 * execute contracts, call APIs, or modify artifacts. Every panel is labelled DEMO.
 */

function DemoLabel() {
  return (
    <Badge variant="outline" className="bg-amber-50 text-amber-800">
      BROWSER DEMO — no chain execution
    </Badge>
  );
}

/* ---------------------------------- N1 ----------------------------------- */
type RclbState = {
  boundEI: number;
  boundEM: number;
  currentEI: number;
  currentEM: number;
  consumed: boolean;
  log: string[];
  decision: string | null;
};

function RclbSim() {
  const [s, setS] = useState<RclbState>({
    boundEI: 1,
    boundEM: 1,
    currentEI: 1,
    currentEM: 1,
    consumed: false,
    log: ["T0: human signs C_t with E_I=1, E_M=1"],
    decision: null,
  });

  const act = (kind: "revokeIdentity" | "revokeMandate" | "rotateKey" | "settle" | "reset") => {
    if (kind === "reset") {
      setS({
        boundEI: 1, boundEM: 1, currentEI: 1, currentEM: 1,
        consumed: false,
        log: ["T0: human signs C_t with E_I=1, E_M=1"],
        decision: null,
      });
      return;
    }
    setS((prev) => {
      if (kind === "settle") {
        if (prev.consumed) return { ...prev, decision: "REJECTED — NONCE_ALREADY_CONSUMED", log: [...prev.log, "Settlement attempt: nonce already used"] };
        if (prev.currentEI !== prev.boundEI) return { ...prev, decision: "REJECTED — IDENTITY_EPOCH_STALE", log: [...prev.log, `Settlement rejected: E_I current=${prev.currentEI} bound=${prev.boundEI}`] };
        if (prev.currentEM !== prev.boundEM) return { ...prev, decision: "REJECTED — MANDATE_EPOCH_STALE", log: [...prev.log, `Settlement rejected: E_M current=${prev.currentEM} bound=${prev.boundEM}`] };
        return { ...prev, consumed: true, decision: "ACCEPTED — epochs current, nonce fresh", log: [...prev.log, "Settlement accepted: guard consumed nonce"] };
      }
      if (kind === "revokeIdentity") return { ...prev, currentEI: prev.currentEI + 1, log: [...prev.log, `Revoked identity: E_I ${prev.currentEI} → ${prev.currentEI + 1}`] };
      if (kind === "revokeMandate") return { ...prev, currentEM: prev.currentEM + 1, log: [...prev.log, `Revoked mandate: E_M ${prev.currentEM} → ${prev.currentEM + 1}`] };
      return { ...prev, currentEI: prev.currentEI + 1, log: [...prev.log, `Rotated key: E_I ${prev.currentEI} → ${prev.currentEI + 1}`] };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <DemoLabel />
        <span className="font-mono text-xs text-muted-foreground">
          bound E_I={s.boundEI} E_M={s.boundEM} · current E_I={s.currentEI} E_M={s.currentEM}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => act("revokeIdentity")}>Revoke identity (T3)</Button>
        <Button size="sm" variant="outline" onClick={() => act("revokeMandate")}>Revoke mandate</Button>
        <Button size="sm" variant="outline" onClick={() => act("rotateKey")}>Rotate key</Button>
        <Button size="sm" onClick={() => act("settle")}>Attempt settlement (T4)</Button>
        <Button size="sm" variant="ghost" onClick={() => act("reset")}>Reset</Button>
      </div>
      {s.decision ? (
        <p className={`text-sm font-semibold ${s.decision.startsWith("ACCEPTED") ? "text-emerald-700" : "text-red-700"}`}>
          {s.decision}
        </p>
      ) : null}
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {s.log.map((line, i) => <li key={i}>{line}</li>)}
      </ol>
    </div>
  );
}

/* ---------------------------------- N3 ----------------------------------- */
function CdepSim() {
  const [substitute, setSubstitute] = useState(false);
  const [expand, setExpand] = useState(false);
  const [redirect, setRedirect] = useState(false);

  const findings = useMemo(() => {
    const f: string[] = [];
    if (substitute) f.push("PARENT_CHILD_AUTHORITY_MISMATCH");
    if (expand) f.push("DELEGATION_SCOPE_EXPANSION");
    if (redirect) f.push("SETTLEMENT_PAYEE_NOT_IN_PATH");
    return f;
  }, [substitute, expand, redirect]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><DemoLabel /><span className="font-mono text-xs">C_exec = H(C_parent, D_child, A_action, P_policy, H_input, H_output)</span></div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label><input type="checkbox" checked={substitute} onChange={(e) => setSubstitute(e.target.checked)} /> substitute intermediate agent</label>
        <label><input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} /> expand child scope</label>
        <label><input type="checkbox" checked={redirect} onChange={(e) => setRedirect(e.target.checked)} /> redirect settlement payee</label>
      </div>
      <p className="text-sm font-semibold">
        Verdict: {findings.length === 0 ? (
          <Badge className="bg-emerald-600 text-white">VALID — authorized lineage</Badge>
        ) : (
          <Badge variant="destructive">INVALID — {findings.length} finding(s)</Badge>
        )}
      </p>
      {findings.length > 0 ? (
        <div className="rounded border border-border bg-muted/40 p-2 font-mono text-xs">
          {findings.map((f) => <div key={f}>• {f}</div>)}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Human → Shopping → {substitute ? "ATTACKER" : "Research/Payment"} → Merchant → Settlement.
        Every consequential action must inherit authority from its parent path.
      </p>
    </div>
  );
}

/* ---------------------------------- N4 ----------------------------------- */
type CfrscState = {
  state: string;
  uncertain: boolean;
  trace: string[];
};

const CFRSC_TRANSITIONS: Record<string, Record<string, string>> = {
  AUTHORIZED: { AUTHORIZE: "RESERVED" },
  RESERVED: { SUBMIT_SETTLEMENT: "SETTLEMENT_PENDING" },
  SETTLEMENT_PENDING: { CONFIRM_SETTLEMENT: "SETTLED", RECONCILE_SETTLED: "SETTLED", RECONCILE_ABSENT: "RESERVED" },
  SETTLED: { START_FULFILLMENT: "FULFILLMENT_PENDING", DISPUTE: "DISPUTED" },
  FULFILLMENT_PENDING: { COMPLETE: "COMPLETED", DISPUTE: "DISPUTED" },
  DISPUTED: { START_COMPENSATION: "COMPENSATION_PENDING" },
  COMPENSATION_PENDING: { REFUND: "COMPENSATED" },
  COMPLETED: {},
  COMPENSATED: {},
};

function CfrscSim() {
  const [c, setC] = useState<CfrscState>({ state: "AUTHORIZED", uncertain: false, trace: ["AUTHORIZED"] });
  const available = Object.keys(CFRSC_TRANSITIONS[c.state] ?? {});

  const dispatch = (cmd: string) => {
    setC((prev) => {
      if (cmd === "TIMEOUT") return { ...prev, uncertain: true, trace: [...prev.trace, "TIMEOUT (uncertain)"] };
      const next = CFRSC_TRANSITIONS[prev.state]?.[cmd];
      if (!next) return prev;
      return { state: next, uncertain: cmd === "RECONCILE_ABSENT" ? false : prev.uncertain, trace: [...prev.trace, `${cmd} → ${next}`] };
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><DemoLabel /><span className="font-mono text-xs">state = {c.state}{c.uncertain ? " (uncertain delivery)" : ""}</span></div>
      <div className="flex flex-wrap gap-2">
        {Object.keys(CFRSC_TRANSITIONS[c.state] ?? {}).map((cmd) => (
          <Button key={cmd} size="sm" variant="outline" onClick={() => dispatch(cmd)}>{cmd}</Button>
        ))}
        {c.state === "SETTLEMENT_PENDING" ? <Button size="sm" variant="secondary" onClick={() => dispatch("TIMEOUT")}>TIMEOUT</Button> : null}
        <Button size="sm" variant="ghost" onClick={() => setC({ state: "AUTHORIZED", uncertain: false, trace: ["AUTHORIZED"] })}>Reset</Button>
      </div>
      <div className="rounded border border-border bg-muted/40 p-2 font-mono text-xs">
        <div className="mb-1 text-muted-foreground">Available here: {available.length ? available.join(", ") : "terminal state"}</div>
        {c.trace.map((t, i) => <div key={i}>{i + 1}. {t}</div>)}
      </div>
      <p className="text-xs text-muted-foreground">
        At-most-once settlement: a duplicate SUBMIT_SETTLEMENT after TIMEOUT replays the original receipt instead of creating a second transfer.
      </p>
    </div>
  );
}

/* ---------------------------------- N5 ----------------------------------- */
function AearvSim() {
  const [I, setI] = useState(0.9);
  const [A, setA] = useState(0.1);
  const [S, setS] = useState(0.1);
  const [D, setD] = useState(0.1);
  const [H, setH] = useState(0.1);
  const [mandatoryFail, setMandatoryFail] = useState(false);

  const R = 0.2 * (1 - I) + 0.25 * A + 0.2 * S + 0.2 * D + 0.15 * H;
  const tier = R < 0.33 ? "V1" : R < 0.66 ? "V2" : "V3";

  const sliders: Array<[string, number, (v: number) => void]> = [
    ["I — identity assurance", I, setI],
    ["A — authorization risk", A, setA],
    ["S — settlement risk", S, setS],
    ["D — delivery risk", D, setD],
    ["H — history risk", H, setH],
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><DemoLabel /><span className="font-mono text-xs">R = 0.20(1−I) + 0.25A + 0.20S + 0.20D + 0.15H</span></div>
      <div className="grid gap-2 md:grid-cols-2">
        {sliders.map(([label, value, setter]) => (
          <label key={label} className="text-xs">
            <div className="flex justify-between"><span>{label}</span><span className="font-mono">{value.toFixed(2)}</span></div>
            <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => setter(Number(e.target.value))} className="w-full" />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>R = <span className="font-mono font-bold">{R.toFixed(3)}</span></span>
        <span>tier = <Badge variant="outline">{tier}</Badge></span>
        <label><input type="checkbox" checked={mandatoryFail} onChange={(e) => setMandatoryFail(e.target.checked)} /> bundle fails a mandatory rule (e.g. R5)</label>
      </div>
      <p className={`text-sm font-semibold ${mandatoryFail ? "text-red-700" : "text-emerald-700"}`}>
        {mandatoryFail ? "REJECT at every tier — mandatory rules are never weakened" : `ALLOW under ${tier}; additive checks only`}
      </p>
    </div>
  );
}

/* ---------------------------------- N2 ----------------------------------- */
type TraceRow = { id: string; model: string[]; impl: string[]; verdict: string; note: string };
const IRCV_CASES: TraceRow[] = [
  { id: "HONEST", model: ["Authorize", "Commit", "Settle", "Verify"], impl: ["Authorize", "Commit", "Settle", "Verify"], verdict: "CONFORMANT", note: "all observed events mapped to model alphabet" },
  { id: "PREDICATE_VIOLATION", model: ["Authorize", "Commit", "Reject"], impl: ["Authorize", "Commit", "Settle", "Reject"], verdict: "MC-P4", note: "settlement event not allowed by model at this state" },
  { id: "REPLAY_PREVENTED", model: ["Authorize", "Commit", "Consume", "Reject(second)"], impl: ["Authorize", "Commit", "Consume", "Reject(second)"], verdict: "CONFORMANT", note: "R9 consume-once" },
  { id: "RCLB_STALE_EPOCH", model: ["(no epoch events)"], impl: ["Reject", "IDENTITY_EPOCH_STALE"], verdict: "OUT_OF_MODEL", note: "RCLB absent from Mode B model alphabet" },
];

function IrcvSim() {
  const [selected, setSelected] = useState(0);
  const row = IRCV_CASES[selected];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><DemoLabel /><span className="font-mono text-xs">Normalize(tau_impl) ⊆ AllowedTraces(M)?</span></div>
      <div className="flex flex-wrap gap-2">
        {IRCV_CASES.map((c, i) => (
          <Button key={c.id} size="sm" variant={i === selected ? "default" : "outline"} onClick={() => setSelected(i)}>{c.id}</Button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">tau_model (normalized)</p>
          <ol className="mt-1 list-decimal pl-5 font-mono text-xs">{row.model.map((e, i) => <li key={i}>{e}</li>)}</ol>
        </div>
        <div className="rounded border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">tau_impl (normalized)</p>
          <ol className="mt-1 list-decimal pl-5 font-mono text-xs">{row.impl.map((e, i) => <li key={i}>{e}</li>)}</ol>
        </div>
      </div>
      <p className="text-sm">
        Verdict: <Badge variant={row.verdict === "CONFORMANT" ? "outline" : "destructive"}>{row.verdict}</Badge>
        <span className="ml-2 text-xs text-muted-foreground">{row.note}</span>
      </p>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Scenario</TableHead><TableHead>Model events</TableHead><TableHead>Impl events</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
        <TableBody>
          {IRCV_CASES.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-mono text-xs">{c.id}</TableCell>
              <TableCell className="font-mono text-xs">{c.model.length}</TableCell>
              <TableCell className="font-mono text-xs">{c.impl.length}</TableCell>
              <TableCell className="text-xs">{c.verdict}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------- container ------------------------------- */
const PANELS = [
  { id: "rclb", title: "N1 — Revocation race", component: <RclbSim /> },
  { id: "cdep", title: "N3 — Delegation tampering", component: <CdepSim /> },
  { id: "cfrsc", title: "N4 — Recovery state machine", component: <CfrscSim /> },
  { id: "aearv", title: "N5 — Risk tier selector", component: <AearvSim /> },
  { id: "ircv", title: "N2 — Trace comparison", component: <IrcvSim /> },
];

export function NoveltySimulators() {
  const [active, setActive] = useState(0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PANELS.map((p, i) => (
          <Button key={p.id} size="sm" variant={i === active ? "default" : "outline"} onClick={() => setActive(i)}>
            {p.title}
          </Button>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">{PANELS[active].title}</h3>
        {PANELS[active].component}
      </div>
    </div>
  );
}
