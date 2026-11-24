```latex
% CDEP paste-ready insert (no citations).
% Placement: a new subsection in the Method/Security section, after the
% cross-layer binding commitment description and before the evaluation setup.
% Requires \usepackage{booktabs} and amsmath (both already used in the paper).

\subsection{Causal delegation and execution provenance}
\label{sec:cdep}

Cross-layer binding fixes \emph{what} a settlement pays for, but a multi-agent
execution may reach that settlement through a chain of delegations. We additionally
bind \emph{which branch} of that delegation graph authorized the final execution.
Each delegation certificate commits to its parent branch, the delegate identity,
the concrete action, the governing policy, and the input/output artifacts:
\begin{equation}
  C_{\mathrm{exec}} = H\!\left(C_{\mathrm{parent}},\, D_{\mathrm{child}},\,
  A_{\mathrm{action}},\, P_{\mathrm{policy}},\, H_{\mathrm{input}},\,
  H_{\mathrm{output}}\right),
  \label{eq:cdep}
\end{equation}
where $H$ is keccak256 over the canonical JSON encoding of the ordered tuple,
$D_{\mathrm{child}}$ is the digest of the delegate identity including its
authorized payment keys, and the root $C_{\mathrm{parent}}$ is the zero digest.
Because each child repeats its parent's $C_{\mathrm{exec}}$ as $C_{\mathrm{parent}}$,
changing any intermediate certificate alters every descendant commitment.

The verifier walks the presented path from the human-authorized root to the
executing agent and emits deterministic findings for seven obligations: (i) each
issuer is the agent delegated authority by its parent; (ii) a child's capability
set (actions, assets, payees, chains, spending cap) is a subset of its parent's,
so delegation is non-expanding; (iii) every declared $C_{\mathrm{exec}}$ equals
its recomputation and each declared $C_{\mathrm{parent}}$ equals the recomputed
parent commitment; (iv) the action targets the terminal delegate and the observed
agent plus payment key match that delegate; (v) the terminal certificate id matches
a trusted branch anchor, preventing substitution of a sibling branch;
(vi) settlement payee, asset, chain, and value lie inside the terminal branch's
delegated scope; and (vii) the graph has unique ids, one root, no dangling parent,
and no cycle. Trusted root and branch anchors are supplied out of band: without
them a writer controlling the whole certificate set could reissue a self-consistent
graph, exactly as an evidence hash chain needs an anchored Merkle root.

\textbf{Evaluation on synthetic DAGs.} We evaluated the engine on one honest
three-node chain and six single-defect variants (substituted intermediate agent,
substituted action, expanded delegation, broken parent link, substituted sibling
branch, substituted payee). The honest case produced zero findings; all six
attacks produced their pre-declared finding codes, with zero false positives
and zero false negatives in this fixture set. These are defect-detection counts
on fixed in-memory fixtures, not measurements of a deployed multi-agent network.
The settlement lineage check binds the payment to the \emph{delegation branch}
scope and complements, rather than replaces, the existing settlement rules that
bind the same payment to the human mandate and registered payee keys.

\begin{table}[t]
\centering
\small
\caption{Causal checks and the substitution each one rejects.}
\label{tab:cdep-checks}
\begin{tabular}{@{}p{0.34\linewidth}p{0.30\linewidth}p{0.28\linewidth}@{}}
\toprule
Obligation & Mechanism & Rejected substitution \\
\midrule
Authority & issuer = parent's delegate & foreign intermediate agent \\
Non-expansion & child scope $\subseteq$ parent scope & raised child spending cap \\
Trace integrity & recompute $C_{\mathrm{exec}}$ and $C_{\mathrm{parent}}$ & reissued action / broken parent link \\
Attribution & observed agent and key = terminal delegate & sibling branch or foreign key \\
Branch anchor & trusted terminal certificate id & attacker branch presented as terminal \\
Payment lineage & payee/asset/chain/value in terminal scope & settlement to attacker payee \\
\bottomrule
\end{tabular}
\end{table}

\textbf{Limitation.} This is an offline, deterministic consistency proof over the
presented certificates. It does not authenticate signatures, fetch anchors, or
prove the certificate set is complete relative to an external event log; those
require a trusted registry/anchor service and are outside this evaluation. We
make no novelty claim over prior literature for this construction.
```
