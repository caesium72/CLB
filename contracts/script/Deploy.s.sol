// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgenticAuditAnchor} from "../src/AgenticAuditAnchor.sol";
import {MockERC8004IdentityRegistry} from "../src/MockERC8004IdentityRegistry.sol";
import {CrossLayerBindingValidator} from "../src/CrossLayerBindingValidator.sol";

/// @notice Deploys the ACEL audit anchor, mock ERC-8004 registry, and the cross-layer-binding validator.
/// Usage (Anvil): forge script script/Deploy.s.sol --rpc-url anvil --broadcast
/// Usage (Base Sepolia): forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
contract Deploy is Script {
    function run()
        external
        returns (
            AgenticAuditAnchor anchor,
            MockERC8004IdentityRegistry registry,
            CrossLayerBindingValidator validator
        )
    {
        // Pass the deployer key via `--private-key` or `--account` on the forge CLI.
        vm.startBroadcast();

        anchor = new AgenticAuditAnchor();
        registry = new MockERC8004IdentityRegistry();
        validator = new CrossLayerBindingValidator();

        vm.stopBroadcast();

        console2.log("AgenticAuditAnchor:", address(anchor));
        console2.log("MockERC8004IdentityRegistry:", address(registry));
        console2.log("CrossLayerBindingValidator:", address(validator));
    }
}
