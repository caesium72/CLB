// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice A new ERC-8004 Validation Registry validator type: cross-layer-binding validation.
///         Records the deterministic verifier's PASS certificate for a trace. Canonical-ready:
///         its fields map 1:1 to the canonical ERC-8004 Validation Registry call
///         validationResponse(requestHash, response, responseURI, responseHash, tag), so the same
///         record can be replayed to the canonical registry once it is deployed on the target chain.
contract CrossLayerBindingValidator {
    struct Validation {
        bytes32 certificateHash; // -> canonical requestHash
        bool result; // -> canonical response (100 = PASS / 0 = FAIL)
        bytes32 merkleRoot; // -> canonical responseHash
        bytes32 settlementTxHash;
        bytes32 zkmlDigest; // reserved for a future zkML proof digest (0x0 for now)
        uint256 timestamp;
    }

    mapping(bytes32 => Validation) public validations;

    error AlreadyValidated();

    event ValidationRecorded(bytes32 indexed traceId, bytes32 certificateHash, bool result);

    /// @notice Record the verifier's certificate for a trace. One entry per trace (mirrors the
    ///         AgenticAuditAnchor one-anchor-per-trace rule); a second write for the same traceId reverts.
    function recordValidation(
        bytes32 traceId,
        bytes32 certificateHash,
        bool result,
        bytes32 merkleRoot,
        bytes32 settlementTxHash
    ) external {
        if (validations[traceId].timestamp != 0) revert AlreadyValidated();
        validations[traceId] =
            Validation(certificateHash, result, merkleRoot, settlementTxHash, bytes32(0), block.timestamp);
        emit ValidationRecorded(traceId, certificateHash, result);
    }

    /// @notice Read a trace's validation. An unrecorded trace returns zeroes (timestamp == 0).
    function getValidation(bytes32 traceId)
        external
        view
        returns (bytes32 certificateHash, bool result, bytes32 merkleRoot, bytes32 settlementTxHash, uint256 timestamp)
    {
        Validation memory entry = validations[traceId];
        return (entry.certificateHash, entry.result, entry.merkleRoot, entry.settlementTxHash, entry.timestamp);
    }
}
