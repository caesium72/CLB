// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title CLBCaveatEnforcer
/// @notice ERC-7710 / MetaMask-Delegation-Framework caveat-enforcer *seam* for
///         the delegated (Mode B) spending predicate. It expresses the same
///         payee / asset / amount / chain predicate as `PredicatePaymentGuard`,
///         but shaped as a caveat enforcer so it can compose with the audited
///         MetaMask Delegation Framework as the "production delegation" story.
///
/// @dev **Swappable adapter, not the headline.** The bulletproof Phase 7A claim
///      is the real on-chain revert in `PredicatePaymentGuard.validateAndConsume`.
///      This contract is the production-delegation seam: a thin
///      `ICaveatEnforcer`-shaped surface that reverts on a predicate violation
///      during delegation redemption. A fully battle-hardened enforcer
///      (gas-optimized, audited, wired to the DTF `beforeHook(...)` signature
///      and EIP-712 redemption) remains future work — see DECISIONS.md.
contract CLBCaveatEnforcer {
    error CaveatPredicateViolation();

    /// @notice Predicate terms the human signs into the caveat.
    struct Terms {
        address allowedPayee;
        address allowedAsset;
        uint256 maxValueAtomic;
        uint256 allowedChainId;
    }

    /// @notice Concrete settlement the agent attempts at redemption time.
    struct Execution {
        address payTo;
        address asset;
        uint256 valueAtomic;
        uint256 chainId;
    }

    /// @notice Enforce the predicate caveat. Reverts `CaveatPredicateViolation`
    ///         if the concrete `execution` falls outside the signed `terms`.
    /// @dev Signature mirrors the ERC-7710 caveat-enforcer shape
    ///      (terms, execution, delegationHash, redeemer, delegator). The last
    ///      three are accepted for interface compatibility; this seam keys off
    ///      `terms` vs. `execution` only.
    function enforceCaveat(
        bytes calldata terms,
        bytes calldata execution,
        bytes32, /* delegationHash */
        address, /* redeemer */
        address /* delegator */
    ) external pure {
        Terms memory t = abi.decode(terms, (Terms));
        Execution memory e = abi.decode(execution, (Execution));

        if (e.payTo != t.allowedPayee) revert CaveatPredicateViolation();
        if (e.asset != t.allowedAsset) revert CaveatPredicateViolation();
        if (e.valueAtomic > t.maxValueAtomic) revert CaveatPredicateViolation();
        if (e.chainId != t.allowedChainId) revert CaveatPredicateViolation();
    }
}
