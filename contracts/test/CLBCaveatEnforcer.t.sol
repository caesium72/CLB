// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CLBCaveatEnforcer} from "../src/CLBCaveatEnforcer.sol";

contract CLBCaveatEnforcerTest is Test {
    CLBCaveatEnforcer private enf;

    address private constant MERCHANT = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address private constant ATTACKER = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address private constant ASSET = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia USDC

    function setUp() public {
        enf = new CLBCaveatEnforcer();
    }

    function _terms() internal view returns (bytes memory) {
        return abi.encode(MERCHANT, ASSET, uint256(2_000_000), block.chainid);
    }

    function test_Enforce_Allows_WhenPredicateHolds() public view {
        bytes memory execution = abi.encode(MERCHANT, ASSET, uint256(2_000_000), block.chainid);
        // Does not revert.
        enf.enforceCaveat(_terms(), execution, bytes32(0), address(this), address(this));
    }

    function test_Enforce_RevertsOnPayeeViolation() public {
        bytes memory execution = abi.encode(ATTACKER, ASSET, uint256(2_000_000), block.chainid);
        vm.expectRevert(CLBCaveatEnforcer.CaveatPredicateViolation.selector);
        enf.enforceCaveat(_terms(), execution, bytes32(0), address(this), address(this));
    }

    function test_Enforce_RevertsOnAmountViolation() public {
        bytes memory execution = abi.encode(MERCHANT, ASSET, uint256(3_000_000), block.chainid);
        vm.expectRevert(CLBCaveatEnforcer.CaveatPredicateViolation.selector);
        enf.enforceCaveat(_terms(), execution, bytes32(0), address(this), address(this));
    }

    function test_Enforce_RevertsOnAssetViolation() public {
        bytes memory execution = abi.encode(MERCHANT, address(0x1234), uint256(2_000_000), block.chainid);
        vm.expectRevert(CLBCaveatEnforcer.CaveatPredicateViolation.selector);
        enf.enforceCaveat(_terms(), execution, bytes32(0), address(this), address(this));
    }

    function test_Enforce_RevertsOnChainViolation() public {
        bytes memory execution = abi.encode(MERCHANT, ASSET, uint256(2_000_000), uint256(1));
        vm.expectRevert(CLBCaveatEnforcer.CaveatPredicateViolation.selector);
        enf.enforceCaveat(_terms(), execution, bytes32(0), address(this), address(this));
    }
}
