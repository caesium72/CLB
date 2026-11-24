```latex
% Reviewer #4, Comment 2 -- paste-ready insert.
% Placement: add as a new subsection in the Evaluation/Security section, after the
% evidence-integrity discussion and before the threat-model limitations paragraph.
% Requires \usepackage{booktabs} (already used elsewhere in the manuscript).

\subsection{Trust model of the evidence graph and detection of injected selections}
\label{sec:evidence-trust-model}

The evidence graph is assembled by the shopping agent, which is untrusted. We therefore
distinguish \emph{internal consistency} from \emph{integrity against an independent anchor}.
Each event is hashed as $H(e)=\operatorname{keccak256}(\operatorname{canonicalJson}(e))$ over
the whole event, including its signature; every event after the first stores
$\operatorname{prev}=H(e_{i-1})$, and a binary Merkle root
$R=\operatorname{Merkle}(H(e_1),\ldots,H(e_n))$ commits to the ordered event set. The
verifier's rule R1 recomputes these links, checks any declared per-event hashes, and
requires the recomputed root to equal the declared root. Consequently, modifying, deleting,
reordering, or substituting an event is detected \emph{relative to a declared root}: each
change alters the affected hash, breaks the subsequent chain link, and changes $R$.

This check alone is not integrity. Because no secret enters the chain, an agent that can
write the event set can also strip the links, re-link, and recompute all hashes and the
root for an arbitrarily edited set; R1 then passes again. We therefore added a trusted-root
comparison: the verifier accepts an externally obtained expected root (read, for example,
from the on-chain \texttt{AgenticAuditAnchor} by the caller) and rejects a bundle whose
recomputed root differs from it. A strict mode refuses to emit an integrity PASS when no
such root is supplied, replacing a silent unverified PASS with an explicit failure. R1 also
checks that event identifiers are unique and, when the caller supplies the object types
required by the human-signed mandate, that none is missing; these structural checks catch
naive omission or duplicate-id fabrication. Malformed event signatures are rejected, and
because the signature is inside the hashed event, swapping one also breaks the chain.

\paragraph{Residual limitation.} Without a trusted anchor, prevention of omitted or
fabricated events is impossible for the verifier: only detection by comparison is possible,
and only when the trusted root is actually supplied. The verifier does not itself read the
on-chain anchor (it has no network dependency and supports offline verification), so the
anchored root must be fetched and passed in by the calling service; the certificate records
the trace Merkle root but not yet an anchor transaction reference. Likewise, the structural
completeness rule establishes presence, not authenticity: fabricated placeholder events of
the required types can satisfy it, and R1 does not recover event signatures against actor
keys. We therefore report this as a medium-severity limitation, not as a closed gap;
closing it requires an anchored-root comparison in the production verifier and per-event
signature authentication.

\paragraph{Prompt-injection detection.} We do not perform natural-language analysis of the
prompt. The audit check detects the \emph{observable effect} of a suspected injection. It
locates the first \texttt{ERC8004\_AGENT\_SELECTION} evidence event, reads
\texttt{publicFields.selectedPayee}, and compares it with
\texttt{mandate.constraints.allowedPayees} using EIP-55 checksummed addresses (viem's
\texttt{getAddress}); case differences are ignored, malformed addresses fail to match, and a
selection outside the allowlist is reported as a finding. In the implementation a positive
finding is \texttt{ok=true}; this is a finding flag, not a safety verdict. The check is
audit-only: it does not fail a verifier rule by itself. If the agent omits the selection
event or records a benign payee while settling elsewhere, the audit check is silent; the
deterministic verifier independently enforces the payee constraint on the \emph{actual}
settlement (rule R12, against both the mandate/predicate allowlist and the registered
merchant keys), so such a substitution is still rejected at settlement. The detector thus
catches unauthorized selection effects when they are logged, but does not observe the
injection instruction itself, nor does it claim to prevent it.

\begin{table}[t]
\centering
\small
\caption{Evidence-trust controls and their residual limits.}
\label{tab:evidence-trust}
\begin{tabular}{@{}p{0.30\linewidth}p{0.32\linewidth}p{0.30\linewidth}@{}}
\toprule
Mechanism & Detects & Does not detect \\
\midrule
Hash chain + Merkle root (R1) & Edit, deletion, reordering, substitution vs a declared root & Self-consistent rewrite when the whole chain and root are recomputed \\
Trusted expected root / strict mode & Rewrite vs an independently anchored root & Incorrect or unanchored root supplied by the caller \\
Unique ids + required object types & Naive omission, duplicate-id fabrication & Well-shaped fabricated events; signature forgery \\
Selection audit check & Unauthorized payee choice recorded in evidence & The injection instruction itself; omissions from the evidence set \\
Rule R12 on actual settlement & Payee substitution at payment time & Manipulated agent reasoning absent a payee change \\
\bottomrule
\end{tabular}
\end{table}
```
