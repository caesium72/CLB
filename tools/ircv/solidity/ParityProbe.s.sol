// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// IRCV cross-language helper: executes the REAL Solidity commitment formulas
// on seeded inputs produced by the TypeScript side. It never modifies a core
// contract; it only calls existing pure/view functions on PredicatePaymentGuard.

import {Script} from "forge-std/Script.sol";
import {PredicatePaymentGuard} from "clb/PredicatePaymentGuard.sol";

contract ParityProbe is Script {
    function run() external {
        string memory inputPath = vm.envString("IRCV_PARITY_INPUT");
        string memory outputPath = vm.envString("IRCV_PARITY_OUTPUT");
        string memory input = vm.readFile(inputPath);
        uint256 count = vm.parseJsonUint(input, ".count");

        string memory out = "{\"vectors\":[";
        for (uint256 i = 0; i < count; i++) {
            string memory b = string.concat(".vectors[", vm.toString(i), "]");
            uint256 domainChainId = vm.parseJsonUint(input, string.concat(b, ".chainId"));
            address registryAddr = vm.parseJsonAddress(input, string.concat(b, ".registryAddr"));
            string memory agentId = vm.parseJsonString(input, string.concat(b, ".agentId"));
            bytes32 mandateDigest = vm.parseJsonBytes32(input, string.concat(b, ".mandateDigest"));
            string memory predicateId = vm.parseJsonString(input, string.concat(b, ".predicateId"));
            address[] memory payees = vm.parseJsonAddressArray(input, string.concat(b, ".payees"));
            bytes32[] memory assetHashes = vm.parseJsonBytes32Array(input, string.concat(b, ".assetHashes"));
            uint256[] memory chainIds = vm.parseJsonUintArray(input, string.concat(b, ".chainIds"));
            uint256 maxValueAtomic = vm.parseJsonUint(input, string.concat(b, ".maxValueAtomic"));
            uint64 validUntil = uint64(vm.parseJsonUint(input, string.concat(b, ".validUntil")));
            bytes32[] memory agentIdHashes = vm.parseJsonBytes32Array(input, string.concat(b, ".agentIdHashes"));
            bytes32 taskHash = vm.parseJsonBytes32(input, string.concat(b, ".taskHash"));
            address principal = vm.parseJsonAddress(input, string.concat(b, ".principal"));
            string memory valueDecimal = vm.parseJsonString(input, string.concat(b, ".params.value"));

            uint256 pChain = vm.parseJsonUint(input, string.concat(b, ".params.chainId"));
            string memory network = vm.parseJsonString(input, string.concat(b, ".params.network"));
            string memory asset = vm.parseJsonString(input, string.concat(b, ".params.asset"));
            address payTo = vm.parseJsonAddress(input, string.concat(b, ".params.payTo"));
            uint256 valueAtomic = vm.parseJsonUint(input, string.concat(b, ".params.valueAtomic"));
            string memory validBefore = vm.parseJsonString(input, string.concat(b, ".params.validBefore"));
            string memory payerAgentId = vm.parseJsonString(input, string.concat(b, ".params.payerAgentId"));

            PredicatePaymentGuard guard = new PredicatePaymentGuard(domainChainId);
            PredicatePaymentGuard.PredicateConfig memory cfg = PredicatePaymentGuard.PredicateConfig({
                allowedPayees: payees,
                allowedAssetHashes: assetHashes,
                allowedChainIds: chainIds,
                maxValueAtomic: maxValueAtomic,
                validUntil: validUntil,
                registered: false
            });
            PredicatePaymentGuard.SettlementParams memory p = PredicatePaymentGuard.SettlementParams({
                chainId: pChain,
                network: network,
                asset: asset,
                payTo: payTo,
                value: valueDecimal,
                valueAtomic: valueAtomic,
                validBefore: validBefore,
                payerAgentId: payerAgentId
            });
            guard.registerPredicate(predicateId, cfg);

            bytes32 extras = keccak256(abi.encode(agentIdHashes, taskHash));
            bytes32 configDigest = guard.predicateDigest(cfg);
            bytes32 fullDigest = guard.predicateDigestWithExtras(cfg, extras);
            bytes32 paramsDigest = guard.settlementParamsDigest(p);
            bytes32 cp = guard.computeSettlementCommitment(
                PredicatePaymentGuard.IdentityRef({
                    chainId: domainChainId,
                    registryAddr: registryAddr,
                    agentId: agentId
                }),
                mandateDigest,
                predicateId,
                extras,
                p
            );
            bytes32 nonce = guard.deriveNonce(cp);
            uint256 parsedAtomic = guard.parseUnits6(valueDecimal);
            bytes32 binding = guard.bindingDigest(predicateId, cfg, principal, mandateDigest, taskHash, extras);

            out = string.concat(
                out,
                i == 0 ? "" : ",",
                "{\"id\":", vm.toString(i),
                ",\"configDigest\":\"", vm.toString(configDigest),
                "\",\"extrasDigest\":\"", vm.toString(extras),
                "\",\"predicateDigest\":\"", vm.toString(fullDigest),
                "\",\"paramsDigest\":\"", vm.toString(paramsDigest),
                "\",\"cPrime\":\"", vm.toString(cp),
                "\",\"nonce\":\"", vm.toString(nonce),
                "\",\"parsedAtomic\":\"", vm.toString(parsedAtomic),
                "\",\"bindingDigest\":\"", vm.toString(binding),
                "\"}"
            );
        }
        out = string.concat(out, "]}");
        vm.writeFile(outputPath, out);
    }
}
