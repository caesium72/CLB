// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PredicatePaymentGuard
/// @notice Demo caveat enforcer for the delegated (Mode B) flow. A human signs a
///         spending predicate at authorization time; the agent later picks
///         concrete settlement params within it. This guard recomputes the
///         settlement-time commitment
///
///           C' = keccak256(EIP712(identityRef, mandateDigest, predicateId, settlementParamsDigest))
///
///         with byte-exact parity to the clb-core package, enforces the
///         registered predicate (payee / asset / chain / amount / expiry), and
///         consumes `nonce == keccak256(C')` exactly once (P3 freshness for
///         Mode B).
///
/// @dev Demo substitute for an ERC-7710 smart-account caveat enforcer — NOT a
///      production delegation implementation (see DECISIONS.md). Amounts are
///      enforced as integer atomic units (`valueAtomic`); the human-readable
///      decimal `value` string is the field bound into C'.
contract PredicatePaymentGuard {
    struct IdentityRef {
        uint256 chainId;
        address registryAddr;
        string agentId;
    }

    struct SettlementParams {
        uint256 chainId;
        string network;
        string asset;
        address payTo;
        string value;
        string validBefore;
        string payerAgentId;
    }

    struct PredicateConfig {
        address[] allowedPayees;
        bytes32[] allowedAssetHashes; // keccak256(bytes(asset))
        uint256[] allowedChainIds;
        uint256 maxValueAtomic;
        uint64 validUntil;
        bool registered;
    }

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 public constant IDENTITY_REF_TYPEHASH =
        keccak256("IdentityRef(uint256 chainId,address registryAddr,string agentId)");
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)"
    );

    /// @notice EIP-712 domain separator. Mirrors viem's domain with no
    ///         verifyingContract: name "CLB-ACEL", version "0.1", chainId.
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(bytes32 => PredicateConfig) private _predicates; // keccak256(bytes(predicateId)) => config
    mapping(bytes32 => bool) public consumed; // nonce => used

    error PredicateNotRegistered(bytes32 predicateIdHash);
    error PredicateAlreadyRegistered(bytes32 predicateIdHash);
    error NonceAlreadyConsumed(bytes32 nonce);
    error CommitmentMismatch(bytes32 expected, bytes32 provided);
    error NonceMismatch(bytes32 expected, bytes32 provided);
    error PayeeNotAllowed(address payTo);
    error AssetNotAllowed(string asset);
    error ChainNotAllowed(uint256 chainId);
    error AmountExceedsMax(uint256 valueAtomic, uint256 maxValueAtomic);
    error PredicateExpired(uint64 validUntil);

    event PredicateRegistered(bytes32 indexed predicateIdHash);
    event SettlementConsumed(bytes32 indexed nonce, bytes32 indexed commitment, address payTo);

    constructor(uint256 domainChainId) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("CLB-ACEL")),
                keccak256(bytes("0.1")),
                domainChainId
            )
        );
    }

    /// @notice Register the predicate config a settlement is checked against.
    function registerPredicate(string calldata predicateId, PredicateConfig calldata config) external {
        bytes32 idHash = keccak256(bytes(predicateId));
        if (_predicates[idHash].registered) {
            revert PredicateAlreadyRegistered(idHash);
        }
        PredicateConfig storage cfg = _predicates[idHash];
        cfg.allowedPayees = config.allowedPayees;
        cfg.allowedAssetHashes = config.allowedAssetHashes;
        cfg.allowedChainIds = config.allowedChainIds;
        cfg.maxValueAtomic = config.maxValueAtomic;
        cfg.validUntil = config.validUntil;
        cfg.registered = true;
        emit PredicateRegistered(idHash);
    }

    function isRegistered(string calldata predicateId) external view returns (bool) {
        return _predicates[keccak256(bytes(predicateId))].registered;
    }

    /// @notice keccak256(abi.encode(...)) of the concrete settlement params.
    ///         Byte-identical to clb-core `computeSettlementParamsDigest`.
    function settlementParamsDigest(SettlementParams calldata p) public pure returns (bytes32) {
        return keccak256(abi.encode(p.chainId, p.network, p.asset, p.payTo, p.value, p.validBefore, p.payerAgentId));
    }

    function _identityRefHash(IdentityRef calldata id) internal pure returns (bytes32) {
        return keccak256(abi.encode(IDENTITY_REF_TYPEHASH, id.chainId, id.registryAddr, keccak256(bytes(id.agentId))));
    }

    /// @notice Recompute C' for the given inputs (EIP-712 digest).
    function computeSettlementCommitment(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        SettlementParams calldata p
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_TYPEHASH,
                _identityRefHash(id),
                mandateDigest,
                keccak256(bytes(predicateId)),
                settlementParamsDigest(p)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice nonce = H(C') = keccak256(C').
    function deriveNonce(bytes32 commitment) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(commitment));
    }

    function _contains(address[] storage list, address value) private view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == value) return true;
        }
        return false;
    }

    function _contains(bytes32[] storage list, bytes32 value) private view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == value) return true;
        }
        return false;
    }

    function _contains(uint256[] storage list, uint256 value) private view returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == value) return true;
        }
        return false;
    }

    /// @notice Validate the binding + predicate and consume the nonce once.
    /// @param valueAtomic Concrete value in integer atomic units, for the
    ///        numeric `<= maxValue` check (the decimal `p.value` string is bound in C').
    /// @return commitment The recomputed C'.
    function validateAndConsume(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        SettlementParams calldata p,
        bytes32 commitment,
        bytes32 nonce,
        uint256 valueAtomic
    ) external returns (bytes32) {
        bytes32 idHash = keccak256(bytes(predicateId));
        PredicateConfig storage cfg = _predicates[idHash];
        if (!cfg.registered) revert PredicateNotRegistered(idHash);

        // 1. Binding integrity: C' recomputes and nonce = H(C').
        bytes32 recomputed = computeSettlementCommitment(id, mandateDigest, predicateId, p);
        if (recomputed != commitment) revert CommitmentMismatch(recomputed, commitment);
        bytes32 expectedNonce = keccak256(abi.encodePacked(commitment));
        if (expectedNonce != nonce) revert NonceMismatch(expectedNonce, nonce);

        // 2. Replay (P3 for Mode B).
        if (consumed[nonce]) revert NonceAlreadyConsumed(nonce);

        // 3. Predicate field checks (P5).
        if (!_contains(cfg.allowedPayees, p.payTo)) revert PayeeNotAllowed(p.payTo);
        if (!_contains(cfg.allowedAssetHashes, keccak256(bytes(p.asset)))) revert AssetNotAllowed(p.asset);
        if (!_contains(cfg.allowedChainIds, p.chainId)) revert ChainNotAllowed(p.chainId);
        if (valueAtomic > cfg.maxValueAtomic) revert AmountExceedsMax(valueAtomic, cfg.maxValueAtomic);
        if (block.timestamp > cfg.validUntil) revert PredicateExpired(cfg.validUntil);

        consumed[nonce] = true;
        emit SettlementConsumed(nonce, commitment, p.payTo);
        return commitment;
    }
}
