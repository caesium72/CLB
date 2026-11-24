% === Paste after the baseline-definition paragraph in §Result Analysis / Experimental Setup (main.tex:417) ===
We distinguish two configurations. In the \emph{evaluated pipeline}, the verifier checks the completed trace after the x402 facilitator has issued a settlement receipt. In the \emph{gated configuration}, a pre-settlement Mode~A authorization gate additionally checks the submitted authorization against the human-signed commitment before the facilitator is called. The gate derives the settlement descriptor from the authorization, recomputes $C = \mathrm{EIP712}(\mathit{identityRef},\mathit{mandateDigest},\mathit{settlementDigest})$ and $n = H(C)$, verifies the human signature against an independently anchored principal, and verifies the x402 payment signature. The original B0--B3 matrix reports the evaluated pipeline; the gated column in Table~\ref{tab:summary} is an additional experiment and composes the original five preventions with two newly demonstrated Mode~A preventions.

% === Replace the Quantitative Results paragraph (main.tex:420-421) ===
Table~\ref{tab:summary} shows that B0 and B1 allowed all 14 unsafe cases while B2 detected all cases but stopped none. In the evaluated pipeline, B3 detected every case and prevented five: the replay and all four delegated-predicate violations. The remaining nine were detected only after settlement, because verification was performed after the facilitator had issued a receipt; this is a placement artifact, not a weakness of the commitment, since in Mode~A the payee and amount are inside $\mathit{settlementDigest}$ and are therefore covered by the human's EIP-712 signature over $C$. We additionally implemented and evaluated a pre-settlement Mode~A authorization gate that enforces this binding before the transfer. With the gate, Mode~A payee substitution and amount escalation are both rejected with no settlement receipt, raising pre-settlement prevention from five of 14 in the evaluated pipeline to seven of 14 in the gated configuration; the other seven Mode~A attacks remain post-settlement detections. An honest Mode~A authorization and the delegated happy path both pass the gate and settle. Figure~\ref{fig:outcomes} visualizes the evaluated-pipeline dispositions.

% === Replace Table 1 (main.tex:423-438) ===
\begin{table}[t]
\centering
\caption{Aggregate outcomes over 14 unsafe cases and one happy path. The evaluated pipeline verifies after settlement; the gated column adds a pre-settlement Mode~A authorization gate.} % CHECK: gated column is an additional experiment, not a re-run of all 14 cases.
\label{tab:summary}
\footnotesize
\begin{tabular}{lccccc}
\toprule
Outcome & B0 & B1 & B2 & B3 & B3 (gated) \\
\midrule
Unsafe allowed & 14 & 14 & 0 & 0 & 0 \\
Detected after settlement & 0 & 0 & 14 & 9 & 7 \\
Prevented before settlement & 0 & 0 & 0 & 5 & 7 \\
Happy path allowed & 1 & 1 & 1 & 1 & 1 \\
\bottomrule
\end{tabular}
\end{table}

% === Replace Figure 1 caption (main.tex:463-464) ===
\caption{Disposition of the 14 unsafe cases by baseline in the evaluated pipeline. B3 detects nine after settlement and prevents five before transfer; with the added pre-settlement authorization gate, seven are prevented and seven are detected after settlement.}
\label{fig:outcomes}
