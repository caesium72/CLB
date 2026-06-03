// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PredicatePaymentGuard} from "../src/PredicatePaymentGuard.sol";

contract PredicatePaymentGuardTest is Test {
    PredicatePaymentGuard private guard;

    uint256 private constant CHAIN_ID = 84532;
    address private constant MERCHANT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address private constant ATTACKER = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address private constant REGISTRY = 0x0000000000000000000000000000000000008004;
    string private constant PREDICATE_ID = "predicate-001";
    string private constant AGENT_ID = "shopping-agent-001";
    bytes32 private constant MANDATE_DIGEST =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 private constant MAX_VALUE_ATOMIC = 5_000_000; // 5 USDC (6 decimals)

    function setUp() public {
        guard = new PredicatePaymentGuard(CHAIN_ID);
        _registerDefaultPredicate(type(uint64).max);
    }

    function _registerDefaultPredicate(uint64 validUntil) internal {
        address[] memory payees = new address[](1);
        payees[0] = MERCHANT;
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = keccak256(bytes("USDC"));
        uint256[] memory chains = new uint256[](1);
        chains[0] = CHAIN_ID;
        guard.registerPredicate(
            PREDICATE_ID,
            PredicatePaymentGuard.PredicateConfig({
                allowedPayees: payees,
                allowedAssetHashes: assets,
                allowedChainIds: chains,
                maxValueAtomic: MAX_VALUE_ATOMIC,
                validUntil: validUntil,
                registered: true
            })
        );
    }

    function _identity() internal pure returns (PredicatePaymentGuard.IdentityRef memory) {
        return PredicatePaymentGuard.IdentityRef({chainId: CHAIN_ID, registryAddr: REGISTRY, agentId: AGENT_ID});
    }

    function _params(address payTo, string memory asset, uint256 chainId)
        internal
        pure
        returns (PredicatePaymentGuard.SettlementParams memory)
    {
        return PredicatePaymentGuard.SettlementParams({
            chainId: chainId,
            network: "base-sepolia",
            asset: asset,
            payTo: payTo,
            value: "2.00",
            validBefore: "2026-12-30T06:00:00.000Z",
            payerAgentId: AGENT_ID
        });
    }

    function _commitAndNonce(PredicatePaymentGuard.SettlementParams memory p)
        internal
        view
        returns (bytes32 commitment, bytes32 nonce)
    {
        commitment = guard.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, p);
        nonce = guard.deriveNonce(commitment);
    }

    // Golden vectors from @clb-acel/clb-core (scripts parity) — keep in sync.
    // identity {84532, 0x..8004, "shopping-agent-001"}, mandateDigest 0x11*32,
    // predicateId "predicate-001", params {84532,"base-sepolia","USDC",MERCHANT,
    // "2.00","2026-12-30T06:00:00.000Z","shopping-agent-001"}, domain CLB-ACEL/0.1/84532.
    bytes32 private constant GOLDEN_PARAMS_DIGEST =
        0xdc4dd6a66e545ee162103b9558deb2ef3086f9406a47dac13fe3a5d32c8840ad;
    bytes32 private constant GOLDEN_COMMITMENT =
        0x174816074bf608e96be557222abd230153c0f022825e4e67a9108833bd0f5f69;
    bytes32 private constant GOLDEN_NONCE =
        0xddc0da06d241cd257172f60f6b99a184b6b8be9ebe39961951bd3c1cb0d253c6;

    function test_ParityWithClbCore() public view {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        assertEq(guard.settlementParamsDigest(p), GOLDEN_PARAMS_DIGEST, "params digest parity");
        bytes32 commitment = guard.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, p);
        assertEq(commitment, GOLDEN_COMMITMENT, "C' parity with clb-core");
        assertEq(guard.deriveNonce(commitment), GOLDEN_NONCE, "nonce = H(C') parity");
    }

    function test_HappyPath_ValidateAndConsume() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        bytes32 returned =
            guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);

        assertEq(returned, commitment);
        assertTrue(guard.consumed(nonce));
    }

    function test_RevertWhen_NonceReplayed() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.NonceAlreadyConsumed.selector, nonce));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);
    }

    function test_RevertWhen_CommitmentMismatch() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);
        bytes32 wrong = keccak256("wrong-commitment");

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.CommitmentMismatch.selector, commitment, wrong)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, wrong, nonce, 2_000_000);
    }

    function test_RevertWhen_NonceMismatch() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment,) = _commitAndNonce(p);
        bytes32 wrongNonce = keccak256("wrong-nonce");

        vm.expectRevert(
            abi.encodeWithSelector(
                PredicatePaymentGuard.NonceMismatch.selector, keccak256(abi.encodePacked(commitment)), wrongNonce
            )
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, wrongNonce, 2_000_000);
    }

    function test_RevertWhen_PayeeNotAllowed() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(ATTACKER, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.PayeeNotAllowed.selector, ATTACKER));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);
    }

    function test_RevertWhen_AssetNotAllowed() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "WETH", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.AssetNotAllowed.selector, "WETH"));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);
    }

    function test_RevertWhen_ChainNotAllowed() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", 1);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        vm.expectRevert(abi.encodeWithSelector(PredicatePaymentGuard.ChainNotAllowed.selector, 1));
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 1);
    }

    function test_RevertWhen_AmountExceedsMax() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.AmountExceedsMax.selector, 10_000_000, MAX_VALUE_ATOMIC)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 10_000_000);
    }

    function test_RevertWhen_PredicateExpired() public {
        PredicatePaymentGuard guard2 = new PredicatePaymentGuard(CHAIN_ID);
        address[] memory payees = new address[](1);
        payees[0] = MERCHANT;
        bytes32[] memory assets = new bytes32[](1);
        assets[0] = keccak256(bytes("USDC"));
        uint256[] memory chains = new uint256[](1);
        chains[0] = CHAIN_ID;
        guard2.registerPredicate(
            PREDICATE_ID,
            PredicatePaymentGuard.PredicateConfig({
                allowedPayees: payees,
                allowedAssetHashes: assets,
                allowedChainIds: chains,
                maxValueAtomic: MAX_VALUE_ATOMIC,
                validUntil: uint64(block.timestamp + 100),
                registered: true
            })
        );

        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        bytes32 commitment = guard2.computeSettlementCommitment(_identity(), MANDATE_DIGEST, PREDICATE_ID, p);
        bytes32 nonce = guard2.deriveNonce(commitment);

        vm.warp(block.timestamp + 200);
        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.PredicateExpired.selector, uint64(101))
        );
        guard2.validateAndConsume(_identity(), MANDATE_DIGEST, PREDICATE_ID, p, commitment, nonce, 2_000_000);
    }

    function test_RevertWhen_PredicateNotRegistered() public {
        PredicatePaymentGuard.SettlementParams memory p = _params(MERCHANT, "USDC", CHAIN_ID);
        (bytes32 commitment, bytes32 nonce) = _commitAndNonce(p);
        bytes32 idHash = keccak256(bytes("unknown-predicate"));

        vm.expectRevert(
            abi.encodeWithSelector(PredicatePaymentGuard.PredicateNotRegistered.selector, idHash)
        );
        guard.validateAndConsume(_identity(), MANDATE_DIGEST, "unknown-predicate", p, commitment, nonce, 2_000_000);
    }
}
