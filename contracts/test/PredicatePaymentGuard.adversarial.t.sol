// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PredicatePaymentGuard} from "../src/PredicatePaymentGuard.sol";

/// @notice Adversarial coverage for R3-C2 (predicate authorization/enforcement).
/// @dev `test_Adversarial_*` cases assert conditions the contract DOES enforce.
///      `test_Closed_*` cases are the inverted `test_Gap_*` cases: they assert
///      the item 44-50 gaps are now rejected. The remaining `test_Gap_*` cases
///      document the limits that survive on the 7-arg/6-arg entry points (the
///      stricter checks live only in `validateAndConsumeBound`).
contract PredicatePaymentGuardAdversarialTest is Test {
    PredicatePaymentGuard private guard;

    uint256 private constant CHAIN_ID = 84532;
    address private constant MERCHANT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address private constant ATTACKER = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address private constant REGISTRY = 0x0000000000000000000000000000000000008004;
    string private constant PREDICATE_ID = "predicate-001";
    string private constant ROGUE_ID = "rogue-predicate";
    string private constant AGENT_ID = "shopping-agent-001";
    bytes32 private constant MANDATE_DIGEST =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 private constant MAX_VALUE_ATOMIC = 5_000_000;
    uint256 private constant HUMAN_KEY = 0x1111111111111111111111111111111111111111111111111111111111111111;
    address private human;
    /// @dev Task the human pins at registration; C' is bound to it via `extras`.
    bytes32 private constant TASK_HASH = keccak256("task-A");

    function setUp() public {
        human = vm.addr(HUMAN_KEY);
        guard = new PredicatePaymentGuard(CHAIN_ID);
        vm.startPrank(human);
        _register(guard, PREDICATE_ID, _config(MERCHANT, type(uint64).max));
    }

    // --- helpers ------------------------------------------------------------

    function _config(address payee, uint64 validUntil)
        private
        pure
        returns (PredicatePaymentGuard.PredicateConfig memory)
    {
        address[] memory payees = new address[](1);
        payees[0] = payee;
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = keccak256(bytes("USDC"));
        uint256[] memory chains = new uint256[](1);
        chains[0] = CHAIN_ID;
        return PredicatePaymentGuard.PredicateConfig({
            allowedPayees: payees,
            allowedAssetHashes: assets,
            allowedChainIds: chains,
            maxValueAtomic: MAX_VALUE_ATOMIC,
            validUntil: validUntil,
            registered: true
        });
    }

    function _emptyConfig(uint64 validUntil)
        private
        pure
        returns (PredicatePaymentGuard.PredicateConfig memory cfg)
    {
        cfg = _config(MERCHANT, validUntil);
        cfg.allowedPayees = new address[](0);
    }

    function _agentIds() private pure returns (bytes32[] memory ids) {
        ids = new bytes32[](1);
        ids[0] = keccak256(bytes(AGENT_ID));
    }

    function _extras(bytes32 task) private pure returns (bytes32) {
        return keccak256(abi.encode(_agentIds(), task));
    }

    /// @dev Enforced registration: the human signs the config and the pin.
    ///      Caller must already be pranked as `human`.
    function _register(
        PredicatePaymentGuard g,
        string memory id,
        PredicatePaymentGuard.PredicateConfig memory cfg
    ) private {
        bytes32 extras = _extras(TASK_HASH);
        bytes32 digest = g.bindingDigest(id, cfg, human, MANDATE_DIGEST, TASK_HASH, extras);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(HUMAN_KEY, digest);
        g.registerPredicateBound(
            id, cfg, human, MANDATE_DIGEST, TASK_HASH, extras, abi.encodePacked(r, s, v)
        );
    }

    function _params(address payTo, string memory asset, uint256 chainId)
        private
        pure
        returns (PredicatePaymentGuard.SettlementParams memory)
    {
        return PredicatePaymentGuard.SettlementParams({
            chainId: chainId,
            network: "base-sepolia",
            asset: asset,
            payTo: payTo,
            value: "2.00",
            valueAtomic: 2_000_000,
            validBefore: "2026-12-30T06:00:00.000Z",
            payerAgentId: AGENT_ID
        });
    }

    function _identity() private pure returns (PredicatePaymentGuard.IdentityRef memory) {
        return PredicatePaymentGuard.IdentityRef({chainId: CHAIN_ID, registryAddr: REGISTRY, agentId: AGENT_ID});
    }

    function _commit(bytes32 mandateDigest, string memory predicateId, PredicatePaymentGuard.SettlementParams memory p)
        private
        view
        returns (bytes32 commitment, bytes32 nonce)
    {
        return _commitWith(mandateDigest, predicateId, _extras(TASK_HASH), p);
    }

    function _commitWith(
        bytes32 mandateDigest,
        string memory predicateId,
        bytes32 extras,
        PredicatePaymentGuard.SettlementParams memory p
    ) private view returns (bytes32 commitment, bytes32 nonce) {
        commitment = guard.computeSettlementCommitment(_identity(), mandateDigest, predicateId, extras, p);
        nonce = guard.deriveNonce(commitment);
    }

    // --- enforced conditions ------------------------------------------------

    /// @dev An id that was never registered has no binding either, and the
    ///      binding gate runs before the config gate, so the revert is
    ///      `PredicateNotBound` (the stricter, earlier rejection).
    function test_Adversarial_UnregisteredPredicateRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, ROGUE_ID, p);

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.PredicateNotBound.selector, keccak256(bytes(ROGUE_ID)))
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, ROGUE_ID, p, commitment, nonce);
    }

    function test_Adversarial_DuplicateRegistrationCannotOverwritePolicy() public {
        vm.stopPrank(); // drop setUp's human prank so the attacker can call
        vm.prank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PredicateAlreadyRegistered.selector, keccak256(bytes(PREDICATE_ID))));
        guard.registerPredicate(PREDICATE_ID, _config(ATTACKER, type(uint64).max));
        vm.startPrank(human);

        // The original payee allow-list survived the attempted overwrite.
        PredicatePaymentGuard.SettlementParams memory p = _params(ATTACKER, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PayeeNotAllowed.selector, ATTACKER));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_PayeeSubstitutionRejectedEvenWithRecomputedCommitment() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(ATTACKER, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PayeeNotAllowed.selector, ATTACKER));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_AssetSubstitutionRejectedEvenWithRecomputedCommitment() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "WETH", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.AssetNotAllowed.selector, "WETH"));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_CrossChainTransplantRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", 1);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.ChainNotAllowed.selector, 1));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_DomainChainMismatchBreaksCommitment() public {
        PredicatePaymentGuard otherDomain = new PredicatePaymentGuard(1);
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 wrongDomainCommitment =
            otherDomain.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, _extras(TASK_HASH), p);
        bytes32 expected = guard.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, _extras(TASK_HASH), p);
        bytes32 wrongNonce = guard.deriveNonce(wrongDomainCommitment);

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.CommitmentMismatch.selector, expected, wrongDomainCommitment)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, wrongDomainCommitment, wrongNonce);
    }

    function test_Adversarial_AmountEscalationRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        p.valueAtomic = 10_000_000;
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.AmountExceedsMax.selector, 10_000_000, MAX_VALUE_ATOMIC)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_AmountExactlyAtMaxIsAllowed() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        p.valueAtomic = MAX_VALUE_ATOMIC;
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertTrue(guard.consumed(nonce));
    }

    function test_Adversarial_ExpiredPredicateRejected() public {
        PredicatePaymentGuard shortLived = new PredicatePaymentGuard(CHAIN_ID);
        uint64 expiry = uint64(block.timestamp + 100);
        _register(shortLived, PREDICATE_ID, _config(MERCHANT, expiry));
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 commitment =
            shortLived.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, _extras(TASK_HASH), p);
        bytes32 nonce = shortLived.deriveNonce(commitment);

        vm.warp(block.timestamp + 200);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PredicateExpired.selector, expiry));
        shortLived.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_CommitmentTamperRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);
        bytes32 forged = keccak256("forged-commitment");

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.CommitmentMismatch.selector, commitment, forged));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, forged, nonce);
    }

    function test_Adversarial_NonceTamperRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment,) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);
        bytes32 forgedNonce = keccak256("forged-nonce");

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.NonceMismatch.selector, keccak256(abi.encodePacked(commitment)), forgedNonce)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, forgedNonce);
    }

    function test_Adversarial_NonceReplayRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.NonceAlreadyConsumed.selector, nonce));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
    }

    function test_Adversarial_FailedSettlementLeavesNonceUnconsumedAndRecoverable() public {
        PredicatePaymentGuard shortLived = new PredicatePaymentGuard(CHAIN_ID);
        uint64 expiry = uint64(block.timestamp + 100);
        _register(shortLived, PREDICATE_ID, _config(MERCHANT, expiry));
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 commitment =
            shortLived.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, _extras(TASK_HASH), p);
        bytes32 nonce = shortLived.deriveNonce(commitment);

        vm.warp(block.timestamp + 200);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PredicateExpired.selector, expiry));
        shortLived.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertFalse(shortLived.consumed(nonce), "reverted settlement consumed no nonce");

        vm.warp(block.timestamp - 200);
        shortLived.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertTrue(shortLived.consumed(nonce), "nonce recoverable after failed settlement");
    }

    function test_Adversarial_EmptyAllowListsRejectEveryPayee() public {
        string memory emptyId = "empty-policy";
        PredicatePaymentGuard emptyGuard = new PredicatePaymentGuard(CHAIN_ID);
        _register(emptyGuard, emptyId, _emptyConfig(type(uint64).max));
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 commitment =
            emptyGuard.computeSettlementCommitment(_identity(), MANDATE_DIGEST, emptyId, _extras(TASK_HASH), p);
        bytes32 nonce = emptyGuard.deriveNonce(commitment);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PayeeNotAllowed.selector, MERCHANT));
        emptyGuard.validateAndConsume(_identity(), MANDATE_DIGEST, emptyId, p, commitment, nonce);
    }

    // --- residual limits (still PASS; the stricter checks live only in
    // --- `validateAndConsumeBound`) ------------------------------------------

    // RESIDUAL (item 48, MEDIUM): the chain cross-field check
    // (id.chainId == p.chainId == DOMAIN_CHAIN_ID) lives only in
    // `validateAndConsumeBound`. The 7-arg/6-arg entry points still recompute C'
    // over whatever identityRef the caller supplies, so a settlement whose
    // identityRef claims a different chain passes there.
    function test_Gap_IdentityChainNotCrossCheckedWithSettlementChain() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        PredicatePaymentGuard.IdentityRef memory foreignId =
            PredicatePaymentGuard.IdentityRef({chainId: 1, registryAddr: REGISTRY, agentId: AGENT_ID});
        bytes32 commitment =
            guard.computeSettlementCommitment(foreignId, MANDATE_DIGEST, PREDICATE_ID, _extras(TASK_HASH), p);
        bytes32 nonce = guard.deriveNonce(commitment);

        guard.validateAndConsume(foreignId, MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertTrue(guard.consumed(nonce));
    }

    // RESIDUAL (item 45/P1, MEDIUM): allowedAgentIds is enforced only by
    // clb-core evaluatePredicate. payerAgentId is bound into C' but unchecked
    // on-chain, so a rogue agent id passes the guard.
    function test_Gap_PayerAgentIdNotCheckedOnChain() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        p.payerAgentId = "rogue-agent";
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertTrue(guard.consumed(nonce));
    }

    // --- closed gaps (were HIGH; each asserted the exploit before the fix) ---

    // FIXED (item 44, was HIGH): the legacy `registerPredicate` path is still
    // unauthenticated, but a config it stores carries no `Binding`, so every
    // settlement entry point reverts `PredicateNotBound`. The attacker can no
    // longer settle to itself. (It can still squat a free id; the human takes it
    // over via `registerPredicateBound` — see PredicateGuardSecurity.)
    function test_Closed_AnyoneCanRegisterAndSettleToArbitraryPayee() public {
        vm.stopPrank(); // drop setUp's human prank so the attacker can call
        vm.prank(ATTACKER);
        guard.registerPredicate(ROGUE_ID, _config(ATTACKER, type(uint64).max));
        assertFalse(guard.isBound(ROGUE_ID), "legacy registration creates no binding");

        PredicatePaymentGuard.SettlementParams memory p = _params(ATTACKER, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, ROGUE_ID, p);
        bytes32 idHash = keccak256(bytes(ROGUE_ID));

        vm.startPrank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PredicateNotBound.selector, idHash));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, ROGUE_ID, _extras(TASK_HASH), p, commitment, nonce);

        // Even the "human" caller cannot settle an unbound predicate.
        vm.startPrank(human);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PredicateNotBound.selector, idHash));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, ROGUE_ID, _extras(TASK_HASH), p, commitment, nonce);

        assertFalse(guard.consumed(nonce), "attacker settlement consumed nothing");
    }

    // FIXED (items 45/46, was HIGH): the human principal and the mandate digest
    // are pinned at registration. A settlement signed under a different mandate
    // or a different extras digest is rejected before C' is even recomputed.
    function test_Closed_ConfigIsNotBoundToHumanOrMandateDigest() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 extras = _extras(TASK_HASH);
        bytes32 mandateB = keccak256("human-B-mandate");

        (bytes32 cB, bytes32 nB) = _commit(mandateB, PREDICATE_ID, p);
        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.MandateDigestMismatch.selector, MANDATE_DIGEST, mandateB)
        );
        guard.validateAndConsume(_identity(), mandateB, PREDICATE_ID, extras, p, cB, nB);

        bytes32 swappedExtras = keccak256("swapped-agent-ids-and-task");
        (bytes32 cE, bytes32 nE) = _commitWith(MANDATE_DIGEST, PREDICATE_ID, swappedExtras, p);
        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.ExtrasDigestMismatch.selector, extras, swappedExtras)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, swappedExtras, p, cE, nE);

        assertFalse(guard.consumed(nB) || guard.consumed(nE), "no nonce consumed by a mismatched settlement");
    }

    // FIXED (taskHash, was HIGH): the human pins the task hash, and it enters C'
    // through the extras digest. A commitment built for task-B is rejected.
    function test_Closed_TaskSubstitutionRejectedOnChain() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 taskA = TASK_HASH;
        bytes32 taskB = keccak256("task-B");
        bytes32 extrasA = _extras(taskA);
        bytes32 extrasB = _extras(taskB);

        (bytes32 cA, bytes32 nA) = _commitWith(MANDATE_DIGEST, PREDICATE_ID, extrasA, p);
        (bytes32 cB, bytes32 nB) = _commitWith(MANDATE_DIGEST, PREDICATE_ID, extrasB, p);

        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, extrasA, p, cA, nA);
        assertTrue(guard.consumed(nA), "pinned task-A settles");

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.ExtrasDigestMismatch.selector, extrasA, extrasB));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, extrasB, p, cB, nB);
        assertFalse(guard.consumed(nB), "task-B substitution consumed nothing");
    }

    // FIXED (item 49, was MEDIUM): `validateAndConsumeBound` derives the atomic
    // quantity from the decimal string with parseUnits6 and rejects the
    // divergence. Residual: the 7-arg/6-arg entry points still trust
    // `valueAtomic`, which is nevertheless bound inside the human-signed C'.
    function test_Closed_DecimalAndAtomicAmountInconsistencyRejected() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        p.value = "1000.00"; // 1_000_000_000 atomic at 6 decimals
        p.valueAtomic = 2_000_000; // what the old path enforced
        bytes32 extras = _extras(TASK_HASH);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.expectRevert(
            abi.encodeWithSelector(
                PredicatePaymentGuard.AmountMismatch.selector, p.value, uint256(2_000_000), uint256(1_000_000_000)
            )
        );
        guard.validateAndConsumeBound(
            _identity(), MANDATE_DIGEST, PREDICATE_ID, extras, _agentIds(), TASK_HASH, p, commitment, nonce
        );
        assertFalse(guard.consumed(nonce), "mismatched amount consumed nothing");
    }

    // FIXED (item 50, was MEDIUM): settlement is bound to the human principal, so
    // an observer of a valid (commitment, nonce) can no longer front-run the
    // consumption; the human still settles afterwards.
    function test_Closed_AnyCallerCanFrontRunNonceConsumption() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commit(MANDATE_DIGEST, PREDICATE_ID, p);

        vm.startPrank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PrincipalMismatch.selector, ATTACKER, human));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertFalse(guard.consumed(nonce), "griefer consumed nothing");

        vm.startPrank(human);
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce);
        assertTrue(guard.consumed(nonce), "human can still settle");
    }
}
