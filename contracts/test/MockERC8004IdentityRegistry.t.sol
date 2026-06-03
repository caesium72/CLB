// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC8004IdentityRegistry} from "../src/MockERC8004IdentityRegistry.sol";

contract MockERC8004IdentityRegistryTest is Test {
    MockERC8004IdentityRegistry private registry;

    address private constant SIGNING_KEY = address(0xA11CE);
    address private constant PAYMENT_KEY = address(0xB0B);
    address private constant NEW_PAYMENT_KEY = address(0xCAFE);

    function setUp() public {
        registry = new MockERC8004IdentityRegistry();
    }

    function _register() internal {
        address[] memory signing = new address[](1);
        signing[0] = SIGNING_KEY;
        address[] memory payment = new address[](1);
        payment[0] = PAYMENT_KEY;
        registry.registerAgent("analysis-agent-001", "ipfs://card", signing, payment);
    }

    function test_RegisterAndResolve() public {
        _register();

        (address owner,, MockERC8004IdentityRegistry.Status status) = registry.getAgent("analysis-agent-001");
        assertEq(owner, address(this));
        assertEq(uint256(status), uint256(MockERC8004IdentityRegistry.Status.ACTIVE));
        assertTrue(registry.isPaymentKeyAuthorized("analysis-agent-001", PAYMENT_KEY));
    }

    function test_AuthorizePaymentKey() public {
        _register();
        registry.authorizePaymentKey("analysis-agent-001", NEW_PAYMENT_KEY);
        assertTrue(registry.isPaymentKeyAuthorized("analysis-agent-001", NEW_PAYMENT_KEY));
        assertEq(registry.getAuthorizedPaymentKeys("analysis-agent-001").length, 2);
    }

    function test_RevertWhen_DuplicateRegistration() public {
        _register();
        address[] memory empty = new address[](0);
        vm.expectRevert(
            abi.encodeWithSelector(MockERC8004IdentityRegistry.AgentExists.selector, "analysis-agent-001")
        );
        registry.registerAgent("analysis-agent-001", "ipfs://card", empty, empty);
    }

    function test_RevertWhen_NonOwnerAuthorizes() public {
        _register();
        vm.prank(address(0xDEAD));
        vm.expectRevert(
            abi.encodeWithSelector(MockERC8004IdentityRegistry.NotOwner.selector, "analysis-agent-001")
        );
        registry.authorizePaymentKey("analysis-agent-001", NEW_PAYMENT_KEY);
    }
}
