// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AgenticAuditAnchor
/// @notice Anchors ACEL trace roots/hashes on-chain. Stores only roots and
///         hashes — never raw evidence (full payloads stay off-chain in
///         Postgres/S3). One anchor per traceId in v1.
contract AgenticAuditAnchor {
    struct TraceAnchor {
        bytes32 merkleRoot;
        bytes32 traceHash;
        string metadataURI;
        address anchoredBy;
        uint64 anchoredAt;
        bool exists;
    }

    mapping(bytes32 => TraceAnchor) private anchors;

    event TraceAnchored(
        bytes32 indexed traceId,
        bytes32 merkleRoot,
        bytes32 traceHash,
        string metadataURI,
        address indexed anchoredBy,
        uint64 anchoredAt
    );

    error TraceAlreadyAnchored(bytes32 traceId);
    error TraceNotAnchored(bytes32 traceId);

    /// @notice Anchor a trace root. Reverts if the traceId is already anchored.
    function anchorTrace(
        bytes32 traceId,
        bytes32 merkleRoot,
        bytes32 traceHash,
        string calldata metadataURI
    ) external {
        if (anchors[traceId].exists) {
            revert TraceAlreadyAnchored(traceId);
        }

        anchors[traceId] = TraceAnchor({
            merkleRoot: merkleRoot,
            traceHash: traceHash,
            metadataURI: metadataURI,
            anchoredBy: msg.sender,
            anchoredAt: uint64(block.timestamp),
            exists: true
        });

        emit TraceAnchored(traceId, merkleRoot, traceHash, metadataURI, msg.sender, uint64(block.timestamp));
    }

    /// @notice Read a stored trace anchor. Reverts if not anchored.
    function getTraceAnchor(bytes32 traceId)
        external
        view
        returns (
            bytes32 merkleRoot,
            bytes32 traceHash,
            string memory metadataURI,
            address anchoredBy,
            uint64 anchoredAt
        )
    {
        TraceAnchor storage anchor = anchors[traceId];
        if (!anchor.exists) {
            revert TraceNotAnchored(traceId);
        }
        return (anchor.merkleRoot, anchor.traceHash, anchor.metadataURI, anchor.anchoredBy, anchor.anchoredAt);
    }

    function isAnchored(bytes32 traceId) external view returns (bool) {
        return anchors[traceId].exists;
    }
}
