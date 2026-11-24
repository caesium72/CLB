// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RevocationAwareGuard} from "../src/RevocationAwareGuard.sol";

/// @notice RCLB guard tests. Golden C_t / nonce are produced by clb-core's
///         `computeRevocationAwareCommitment` / `deriveRevocationAwareNonce`.
contract RevocationAwareGuardTest is Test {
    RevocationAwareGuard private guard;

    string private constant AGENT = "rclb-agent-001";
    string private constant UNKNOWN = "unknown-agent";
    bytes32 private constant BASE_COMMITMENT =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    bytes32 private constant NONCE = 0x2222222222222222222222222222222222222222222222222222222222222222;
    bytes32 private constant OTHER_NONCE =
        0x3333333333333333333333333333333333333333333333333333333333333333;
    uint64 private constant GOLDEN_EXPIRY = 1_800_000_000;

    // Golden vector (EI=1, EM=1, expiry=1_800_000_000, N=0x22*32).
    bytes32 private constant GOLDEN_COMMITMENT =
        0x89f2259d2fd8d40cb851d89e3b976a1a52978204f2515c8d690014cd46895758;
    bytes32 private constant GOLDEN_PAYMENT_NONCE =
        0x44998b1e24797bdcecf5e641dc5e566de4e79ce21c48014e7dc61a73861596dd;

    address private constant ATTACKER = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address private constant NEW_KEY = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    /// @dev Storage write prevents the optimizer from eliding the baseline.
    bool private sink;

    function setUp() public {
        // The test contract is the sole authority; no pranks for benign updates.
        guard = new RevocationAwareGuard(address(this));
        guard.initializeEpochs(AGENT, 1, 1);
    }

    function _fields(uint256 ei, uint256 em, uint64 expiry, bytes32 nonce)
        internal
        pure
        returns (RevocationAwareGuard.RevocationAwareCommitment memory)
    {
        return RevocationAwareGuard.RevocationAwareCommitment({
            baseCommitment: BASE_COMMITMENT,
            identityEpoch: ei,
            mandateEpoch: em,
            expiry: expiry,
            nonce: nonce
        });
    }

    function _futureExpiry() internal view returns (uint64) {
        return uint64(block.timestamp + 1000);
    }

    function _commitAndNonce(RevocationAwareGuard.RevocationAwareCommitment memory f)
        internal
        pure
        returns (bytes32 commitment, bytes32 paymentNonce)
    {
        commitment = keccak256(abi.encode(f.baseCommitment, f.identityEpoch, f.mandateEpoch, f.expiry, f.nonce));
        paymentNonce = keccak256(abi.encodePacked(commitment));
    }

    function test_ParityWithClbCore() public view {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, GOLDEN_EXPIRY, NONCE);
        assertEq(guard.computeRevocationAwareCommitment(f), GOLDEN_COMMITMENT, "C_t parity with clb-core");
        assertEq(guard.deriveRevocationAwareNonce(GOLDEN_COMMITMENT), GOLDEN_PAYMENT_NONCE, "nonce = H(C_t)");
    }

    function test_HappyPath_ConsumesOnce() public {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        assertEq(guard.validateAndConsume(AGENT, f, commitment, paymentNonce), commitment);
        assertTrue(guard.consumed(NONCE));
        (uint256 ei, uint256 em) = guard.currentEpochs(AGENT);
        assertEq(ei, 1);
        assertEq(em, 1);
    }

    function test_RevertWhen_IdentityRevoked() public {
        guard.revokeIdentity(AGENT);
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.IdentityEpochStale.selector, 2, 1));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
        assertFalse(guard.consumed(NONCE));
    }

    function test_RevertWhen_MandateRevoked() public {
        guard.revokeMandate(AGENT);
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.MandateEpochStale.selector, 2, 1));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
        assertFalse(guard.consumed(NONCE));
    }

    function test_KeyRotation_InvalidatesOldCommitment() public {
        guard.rotateIdentityKey(AGENT, NEW_KEY);
        assertEq(guard.currentSigningKey(keccak256(bytes(AGENT))), NEW_KEY);

        RevocationAwareGuard.RevocationAwareCommitment memory stale = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 oldCommitment, bytes32 oldNonce) = _commitAndNonce(stale);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.IdentityEpochStale.selector, 2, 1));
        guard.validateAndConsume(AGENT, stale, oldCommitment, oldNonce);

        // A freshly bound C_t under the rotated key can still settle.
        RevocationAwareGuard.RevocationAwareCommitment memory fresh = _fields(2, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(fresh);
        assertEq(guard.validateAndConsume(AGENT, fresh, commitment, paymentNonce), commitment);
    }

    function test_StaleRegistryRead_IsRejected() public {
        // The caller cached {1,1} before revocation; execution reads {2,1}.
        guard.revokeIdentity(AGENT);
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        (uint256 ei, uint256 em) = guard.currentEpochs(AGENT);
        assertEq(ei, 2);
        assertEq(em, 1);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.IdentityEpochStale.selector, ei, 1));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
    }

    function test_Race_RevocationBeforeSettlementWinsAndDoesNotBurnNonce() public {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        // Pre-check would pass at {1,1}; the authority revokes before execution.
        assertEq(guard.computeRevocationAwareCommitment(f), commitment);
        guard.revokeMandate(AGENT);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.MandateEpochStale.selector, 2, 1));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
        assertFalse(guard.consumed(NONCE), "rejected attempt must not consume N");
    }

    function test_DelayedMessage_Expires() public {
        uint64 expiry = uint64(block.timestamp + 1);
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, expiry, NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        vm.warp(block.timestamp + 2);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.CommitmentExpired.selector, expiry));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
    }

    function test_RevertWhen_NonceAlreadyConsumed() public {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.NonceAlreadyConsumed.selector, NONCE));
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
    }

    function test_FailClosed_UnknownAuthorityState() public {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        vm.expectRevert(
            abi.encodeWithSelector(RevocationAwareGuard.AuthorityStateUnavailable.selector, keccak256(bytes(UNKNOWN)))
        );
        guard.validateAndConsume(UNKNOWN, f, commitment, paymentNonce);
    }

    function test_OnlyAuthorityCanRevokeAndRotate() public {
        vm.startPrank(ATTACKER);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.UnauthorizedAuthority.selector, ATTACKER));
        guard.revokeIdentity(AGENT);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.UnauthorizedAuthority.selector, ATTACKER));
        guard.revokeMandate(AGENT);
        vm.expectRevert(abi.encodeWithSelector(RevocationAwareGuard.UnauthorizedAuthority.selector, ATTACKER));
        guard.rotateIdentityKey(AGENT, NEW_KEY);
        vm.stopPrank();
        (uint256 ei, uint256 em) = guard.currentEpochs(AGENT);
        assertEq(ei, 1);
        assertEq(em, 1);
    }

    function test_RevertWhen_CommitmentOrPaymentNonceMismatch() public {
        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        vm.expectRevert(
            abi.encodeWithSelector(RevocationAwareGuard.CommitmentMismatch.selector, commitment, OTHER_NONCE)
        );
        guard.validateAndConsume(AGENT, f, OTHER_NONCE, paymentNonce);
        vm.expectRevert(
            abi.encodeWithSelector(RevocationAwareGuard.NonceMismatch.selector, paymentNonce, OTHER_NONCE)
        );
        guard.validateAndConsume(AGENT, f, commitment, OTHER_NONCE);
    }

    /// @dev LOCAL ANVIL / DEMO gas probe: compares the RCLB settlement path with
    ///      a same-shape baseline that only recomputes C_t and checks the nonce
    ///      (no epoch / expiry enforcement). Numbers are emitted for the report.
    function _baselineAccept(
        RevocationAwareGuard.RevocationAwareCommitment memory f,
        bytes32 commitment,
        bytes32 paymentNonce
    ) internal returns (bool) {
        bytes32 recomputed =
            keccak256(abi.encode(f.baseCommitment, f.identityEpoch, f.mandateEpoch, f.expiry, f.nonce));
        if (recomputed != commitment) return false;
        if (keccak256(abi.encodePacked(commitment)) != paymentNonce) return false;
        return true;
    }

    function test_GasOverheadVsBaseline_LocalAnvilDemo() public {
        RevocationAwareGuard.RevocationAwareCommitment memory baselineFields =
            _fields(1, 1, _futureExpiry(), OTHER_NONCE);
        (bytes32 baselineCommitment, bytes32 baselinePaymentNonce) = _commitAndNonce(baselineFields);

        uint256 startBaseline = gasleft();
        sink = _baselineAccept(baselineFields, baselineCommitment, baselinePaymentNonce);
        uint256 baselineGas = startBaseline - gasleft();

        RevocationAwareGuard.RevocationAwareCommitment memory f = _fields(1, 1, _futureExpiry(), NONCE);
        (bytes32 commitment, bytes32 paymentNonce) = _commitAndNonce(f);
        uint256 startRclb = gasleft();
        guard.validateAndConsume(AGENT, f, commitment, paymentNonce);
        uint256 rclbGas = startRclb - gasleft();

        emit log_named_uint("RCLB baseline gas (local EVM demo)", baselineGas);
        emit log_named_uint("RCLB guard gas (local EVM demo)", rclbGas);
        emit log_named_uint("RCLB overhead gas (local EVM demo)", rclbGas > baselineGas ? rclbGas - baselineGas : 0);
        assertTrue(sink, "baseline must accept the honest fixture");
    }
}
