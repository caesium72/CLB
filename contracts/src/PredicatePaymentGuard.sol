// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PredicatePaymentGuard
/// @notice Demo caveat enforcer for the delegated (Mode B) flow. A human signs a
///         spending predicate at authorization time; the agent later picks
///         concrete settlement params within it. This guard recomputes the
///         settlement-time commitment
///
///           C' = keccak256(EIP712(identityRef, mandateDigest, predicateId,
///                                  predicateDigest, settlementParamsDigest))
///
///         with byte-exact parity to the clb-core package. `predicateDigest` is
///         derived from the REGISTERED predicate config on-chain, so a
///         permissive predicate swapped in under a human-signed predicate ID
///         changes C' and is rejected. Also enforces the registered predicate
///         (payee / asset / chain / amount / expiry), and
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
        uint256 valueAtomic; // integer base-units; the quantity enforced on-chain (bound in C')
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

    /// @notice DEMO authorization anchor for a predicate id. Stored separately
    ///         from `PredicateConfig` so the config digest (and therefore C')
    ///         stays byte-identical to clb-core — this is an additive binding,
    ///         not a redesign of the commitment.
    struct Binding {
        address principal; // human key that registered and may settle
        bytes32 mandateDigest; // human mandate pinned at registration
        bytes32 taskHash; // human-signed task pin (0 = no pin)
        bytes32 extraFieldsDigest; // pins agent IDs + taskHash via clb-core extras digest
        bool bound;
    }

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 public constant IDENTITY_REF_TYPEHASH =
        keccak256("IdentityRef(uint256 chainId,address registryAddr,string agentId)");
    /// @dev Adding `predicateDigest` changes this typehash and therefore every C'.
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "CLBSettlementCommitment(IdentityRef identityRef,bytes32 mandateDigest,string predicateId,bytes32 predicateDigest,bytes32 settlementParamsDigest)IdentityRef(uint256 chainId,address registryAddr,string agentId)"
    );

    /// @notice EIP-712 domain separator. Mirrors viem's domain with no
    ///         verifyingContract: name "CLB-ACEL", version "0.1", chainId.
    bytes32 public immutable DOMAIN_SEPARATOR;
    /// @notice Kept explicitly so id.chainId / p.chainId can be cross-checked
    ///         against the chain the human signature actually covers.
    uint256 public immutable DOMAIN_CHAIN_ID;

    /// @dev Typehash of the DEMO human registration signature payload.
    bytes32 public constant BINDING_TYPEHASH = keccak256(
        "PredicateGuardBinding(string predicateId,bytes32 configDigest,address principal,bytes32 mandateDigest,bytes32 taskHash,bytes32 extraFieldsDigest,uint256 chainId)"
    );
    uint256 private constant _SECP256K1N_HALF =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    mapping(bytes32 => PredicateConfig) private _predicates; // keccak256(bytes(predicateId)) => config
    mapping(bytes32 => Binding) private _bindings; // keccak256(bytes(predicateId)) => human anchor
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

    // --- DEMO bound-registration errors (items 44-49) ---
    error UnauthorizedRegistrant(address caller, address principal);
    error InvalidBindingSignature();
    error PredicateNotBound(bytes32 predicateIdHash);
    error PrincipalMismatch(address caller, address principal);
    error MandateDigestMismatch(bytes32 expected, bytes32 provided);
    error TaskHashMismatch(bytes32 expected, bytes32 provided);
    error ExtrasDigestMismatch(bytes32 expected, bytes32 provided);
    error ChainIdMismatch(uint256 identityChainId, uint256 settlementChainId, uint256 domainChainId);
    error AmountMismatch(string value, uint256 providedAtomic, uint256 expectedAtomic);
    error InvalidDecimalValue(string value);

    event PredicateRegistered(bytes32 indexed predicateIdHash);
    event PredicateBoundRegistered(
        bytes32 indexed predicateIdHash, address indexed principal, bytes32 mandateDigest, bytes32 taskHash
    );
    event SettlementConsumed(bytes32 indexed nonce, bytes32 indexed commitment, address payTo);

    constructor(uint256 domainChainId) {
        DOMAIN_CHAIN_ID = domainChainId;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("CLB-ACEL")),
                keccak256(bytes("0.1")),
                domainChainId
            )
        );
    }

    /// @notice DEMO, UNBOUND registration path retained for source compatibility
    ///         with the existing parity tests. It does NOT authenticate a human
    ///         and creates no `Binding`, so a config registered here can NEVER be
    ///         settled: `validateAndConsume` reverts `PredicateNotBound`. It is a
    ///         fixture/inspection path only, not a settlement path. An attacker
    ///         can register a *new* id here, but cannot overwrite an existing id,
    ///         and `registerPredicateBound` may take over an unbound id.
    function registerPredicate(string calldata predicateId, PredicateConfig calldata config) external {
        bytes32 idHash = keccak256(bytes(predicateId));
        if (_predicates[idHash].registered) {
            revert PredicateAlreadyRegistered(idHash);
        }
        _storePredicate(idHash, config);
        emit PredicateRegistered(idHash);
    }

    function _storePredicate(bytes32 idHash, PredicateConfig calldata config) private {
        PredicateConfig storage cfg = _predicates[idHash];
        cfg.allowedPayees = config.allowedPayees;
        cfg.allowedAssetHashes = config.allowedAssetHashes;
        cfg.allowedChainIds = config.allowedChainIds;
        cfg.maxValueAtomic = config.maxValueAtomic;
        cfg.validUntil = config.validUntil;
        cfg.registered = true;
    }

    function isRegistered(string calldata predicateId) external view returns (bool) {
        return _predicates[keccak256(bytes(predicateId))].registered;
    }

    /// @notice Whether a predicate id was registered through the enforced,
    ///         human-bound path (as opposed to the DEMO legacy path).
    function isBound(string calldata predicateId) external view returns (bool) {
        return _bindings[keccak256(bytes(predicateId))].bound;
    }

    /// @notice Read back the human anchor for a bound predicate id.
    function bindingOf(string calldata predicateId)
        external
        view
        returns (address principal, bytes32 mandateDigest, bytes32 taskHash, bytes32 extraFieldsDigest, bool bound)
    {
        Binding memory b = _bindings[keccak256(bytes(predicateId))];
        return (b.principal, b.mandateDigest, b.taskHash, b.extraFieldsDigest, b.bound);
    }

    /// @notice EIP-191 digest the human signs to bind a predicate registration.
    ///         Mirrors clb-core's `computePredicateGuardBindingDigest`.
    function bindingDigest(
        string calldata predicateId,
        PredicateConfig calldata config,
        address principal,
        bytes32 mandateDigest,
        bytes32 taskHash,
        bytes32 extraFieldsDigest
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                BINDING_TYPEHASH,
                keccak256(bytes(predicateId)),
                predicateDigest(config),
                principal,
                mandateDigest,
                taskHash,
                extraFieldsDigest,
                DOMAIN_CHAIN_ID
            )
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", structHash));
    }

    /// @notice Minimal ECDSA recovery (65-byte r||s||v, low-s enforced). No new
    ///         dependency: the demo guard cannot import OpenZeppelin's ECDSA lib.
    function _recoverBindingSigner(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert InvalidBindingSignature();
        // 65-byte r||s||v is not an ABI-encoded tuple; load the words directly.
        bytes memory sig = signature;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > _SECP256K1N_HALF) revert InvalidBindingSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidBindingSignature();
        return signer;
    }

    /// @notice DEMO enforced registration. The human principal must both submit
    ///         the transaction and sign a binding payload over (predicateId,
    ///         config digest, principal, mandateDigest, taskHash, extras digest,
    ///         domain chain). This makes registration authenticated on-chain:
    ///         nobody can install a policy under a human's identity without the
    ///         human's key. Residual trust: there is no external identity
    ///         registry — `principal` is self-asserted by the signing key.
    function registerPredicateBound(
        string calldata predicateId,
        PredicateConfig calldata config,
        address principal,
        bytes32 mandateDigest,
        bytes32 taskHash,
        bytes32 extraFieldsDigest,
        bytes calldata signature
    ) external {
        bytes32 idHash = keccak256(bytes(predicateId));
        // A bound id cannot be re-registered, but the human may take over an id
        // that an attacker squatted through the unauthenticated legacy path.
        if (_bindings[idHash].bound) revert PredicateAlreadyRegistered(idHash);
        if (principal == address(0) || msg.sender != principal) revert UnauthorizedRegistrant(msg.sender, principal);
        bytes32 digest = bindingDigest(predicateId, config, principal, mandateDigest, taskHash, extraFieldsDigest);
        if (_recoverBindingSigner(digest, signature) != principal) revert InvalidBindingSignature();

        _storePredicate(idHash, config);
        _bindings[idHash] = Binding({
            principal: principal,
            mandateDigest: mandateDigest,
            taskHash: taskHash,
            extraFieldsDigest: extraFieldsDigest,
            bound: true
        });
        emit PredicateBoundRegistered(idHash, principal, mandateDigest, taskHash);
    }

    /// @notice keccak256(abi.encode(...)) of the concrete settlement params.
    ///         Byte-identical to clb-core `computeSettlementParamsDigest`.
    function settlementParamsDigest(SettlementParams calldata p) public pure returns (bytes32) {
        return keccak256(
            abi.encode(p.chainId, p.network, p.asset, p.payTo, p.value, p.valueAtomic, p.validBefore, p.payerAgentId)
        );
    }

    function _identityRefHash(IdentityRef calldata id) internal pure returns (bytes32) {
        return keccak256(abi.encode(IDENTITY_REF_TYPEHASH, id.chainId, id.registryAddr, keccak256(bytes(id.agentId))));
    }

    /// @notice Deterministic digest of the on-chain predicate content. Mirrors
    ///         clb-core's layer-1 `computePredicateDigest` abi.encode exactly.
    function predicateDigest(PredicateConfig memory cfg) public pure returns (bytes32) {
        return keccak256(
            abi.encode(cfg.allowedPayees, cfg.allowedAssetHashes, cfg.allowedChainIds, cfg.maxValueAtomic, cfg.validUntil)
        );
    }

    /// @notice Full predicate digest: layer 1 (config) + agent IDs / task hash.
    ///         The extra digest comes from calldata but is bound into C', so the
    ///         human signature covers it; the config portion is always derived
    ///         from the registered config and cannot be forged by the prover.
    function predicateDigestWithExtras(PredicateConfig memory cfg, bytes32 extraFieldsDigest)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(predicateDigest(cfg), extraFieldsDigest));
    }

    /// @notice Recompute C' with the full predicate content bound in.
    /// @dev `extraFieldsDigest` = keccak256(abi.encode(bytes32[] agentIdHashes, bytes32 taskHash)).
    function computeSettlementCommitment(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        bytes32 extraFieldsDigest,
        SettlementParams calldata p
    ) public view returns (bytes32) {
        PredicateConfig memory cfg = _predicates[keccak256(bytes(predicateId))];
        bytes32 predicateDigest_ = predicateDigestWithExtras(cfg, extraFieldsDigest);
        bytes32 structHash = keccak256(
            abi.encode(
                SETTLEMENT_TYPEHASH,
                _identityRefHash(id),
                mandateDigest,
                keccak256(bytes(predicateId)),
                predicateDigest_,
                settlementParamsDigest(p)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice Legacy signature retained for source compatibility; binds the
    ///         config-derived digest with zero extras.
    function computeSettlementCommitment(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        SettlementParams calldata p
    ) public view returns (bytes32) {
        return computeSettlementCommitment(id, mandateDigest, predicateId, bytes32(0), p);
    }

    /// @notice nonce = H(C') = keccak256(C').
    function deriveNonce(bytes32 commitment) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(commitment));
    }

    /// @notice Parse a decimal string into 6-decimal USDC base units, matching
    ///         viem's `parseUnits(value, 6)` in clb-core. Rejects signs,
    ///         non-digits, empty input and more than 6 fractional digits.
    ///         `shortcut: fixed 6 decimals, upgrade when a multi-decimal asset is registered`.
    function parseUnits6(string calldata value) public pure returns (uint256) {
        bytes memory b = bytes(value);
        if (b.length == 0) revert InvalidDecimalValue(value);
        uint256 whole = 0;
        uint256 frac = 0;
        uint256 fracDigits = 0;
        bool seenDot = false;
        bool seenDigit = false;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x2E) {
                if (seenDot) revert InvalidDecimalValue(value);
                seenDot = true;
            } else if (c >= 0x30 && c <= 0x39) {
                seenDigit = true;
                uint256 d = c - 0x30;
                if (seenDot) {
                    if (fracDigits == 6) revert InvalidDecimalValue(value);
                    frac = frac * 10 + d;
                    fracDigits++;
                } else {
                    whole = whole * 10 + d;
                }
            } else {
                revert InvalidDecimalValue(value);
            }
        }
        if (!seenDigit) revert InvalidDecimalValue(value);
        for (; fracDigits < 6; fracDigits++) {
            frac *= 10;
        }
        return whole * 1_000_000 + frac;
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

    /// @notice Settlement entry point (items 44-46, 50). Now GATED on the human
    ///         binding: a predicate registered through the unauthenticated legacy
    ///         path can never be settled, and the human-pinned mandate digest and
    ///         extras digest must match. Before this gate an agent could submit a
    ///         C' it computed itself with any mandate it liked, because the guard
    ///         only recomputed C' from attacker-chosen inputs.
    /// @dev The amount check uses `p.valueAtomic`, which is bound inside C'
    ///      (Phase 7A) — so the committed and compared quantities are identical.
    ///      C' also binds `predicateDigestWithExtras` of the REGISTERED config,
    ///      so swapping predicate content under the same ID fails binding integrity.
    /// @return commitment The recomputed C'.
    function validateAndConsume(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        bytes32 extraFieldsDigest,
        SettlementParams calldata p,
        bytes32 commitment,
        bytes32 nonce
    ) public returns (bytes32) {
        bytes32 idHash = keccak256(bytes(predicateId));
        Binding memory b = _bindings[idHash];
        if (!b.bound) revert PredicateNotBound(idHash);
        if (msg.sender != b.principal) revert PrincipalMismatch(msg.sender, b.principal);
        if (b.mandateDigest != mandateDigest) revert MandateDigestMismatch(b.mandateDigest, mandateDigest);
        if (b.extraFieldsDigest != extraFieldsDigest) revert ExtrasDigestMismatch(b.extraFieldsDigest, extraFieldsDigest);
        return _consume(id, mandateDigest, predicateId, extraFieldsDigest, p, commitment, nonce);
    }

    /// @dev C'/nonce/replay/policy checks shared by every settlement entry point.
    function _consume(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        bytes32 extraFieldsDigest,
        SettlementParams calldata p,
        bytes32 commitment,
        bytes32 nonce
    ) private returns (bytes32) {
        bytes32 idHash = keccak256(bytes(predicateId));
        PredicateConfig storage cfg = _predicates[idHash];
        if (!cfg.registered) revert PredicateNotRegistered(idHash);

        // 1. Binding integrity: C' recomputes and nonce = H(C').
        bytes32 recomputed = computeSettlementCommitment(id, mandateDigest, predicateId, extraFieldsDigest, p);
        if (recomputed != commitment) revert CommitmentMismatch(recomputed, commitment);
        bytes32 expectedNonce = keccak256(abi.encodePacked(commitment));
        if (expectedNonce != nonce) revert NonceMismatch(expectedNonce, nonce);

        // 2. Replay (P3 for Mode B).
        if (consumed[nonce]) revert NonceAlreadyConsumed(nonce);

        // 3. Predicate field checks (P5).
        if (!_contains(cfg.allowedPayees, p.payTo)) revert PayeeNotAllowed(p.payTo);
        if (!_contains(cfg.allowedAssetHashes, keccak256(bytes(p.asset)))) revert AssetNotAllowed(p.asset);
        if (!_contains(cfg.allowedChainIds, p.chainId)) revert ChainNotAllowed(p.chainId);
        if (p.valueAtomic > cfg.maxValueAtomic) revert AmountExceedsMax(p.valueAtomic, cfg.maxValueAtomic);
        if (block.timestamp > cfg.validUntil) revert PredicateExpired(cfg.validUntil);

        consumed[nonce] = true;
        emit SettlementConsumed(nonce, commitment, p.payTo);
        return commitment;
    }

    /// @notice Legacy 6-arg signature retained for source compatibility. The
    ///         extras digest is taken from the human binding (it cannot be
    ///         supplied by the caller), so C' is always computed over the
    ///         human-signed extras.
    function validateAndConsume(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        SettlementParams calldata p,
        bytes32 commitment,
        bytes32 nonce
    ) external returns (bytes32) {
        bytes32 idHash = keccak256(bytes(predicateId));
        Binding memory b = _bindings[idHash];
        if (!b.bound) revert PredicateNotBound(idHash);
        return validateAndConsume(id, mandateDigest, predicateId, b.extraFieldsDigest, p, commitment, nonce);
    }

    /// @notice DEMO enforced settlement path (items 44-50). Runs the human
    ///         binding checks BEFORE delegating to the existing C'/replay/policy
    ///         checks so every revert rolls all state back. Only the bound
    ///         principal may consume its nonce, which removes third-party
    ///         nonce griefing; the external payment leg is still NOT atomic
    ///         with this call (the guard transfers no funds).
    /// @param agentIdHashes keccak256(bytes(agentId)) values pinned at registration
    /// @param taskHash explicit observed task hash; must equal the human's pin
    function validateAndConsumeBound(
        IdentityRef calldata id,
        bytes32 mandateDigest,
        string calldata predicateId,
        bytes32 extraFieldsDigest,
        bytes32[] calldata agentIdHashes,
        bytes32 taskHash,
        SettlementParams calldata p,
        bytes32 commitment,
        bytes32 nonce
    ) public returns (bytes32) {
        bytes32 idHash = keccak256(bytes(predicateId));
        Binding memory b = _bindings[idHash];
        if (!b.bound) revert PredicateNotBound(idHash);

        // 1. Human binding (items 44-46) + caller binding (item 50).
        if (msg.sender != b.principal) revert PrincipalMismatch(msg.sender, b.principal);
        if (b.mandateDigest != mandateDigest) revert MandateDigestMismatch(b.mandateDigest, mandateDigest);
        if (b.taskHash != taskHash) revert TaskHashMismatch(b.taskHash, taskHash);
        if (b.extraFieldsDigest != extraFieldsDigest) revert ExtrasDigestMismatch(b.extraFieldsDigest, extraFieldsDigest);

        // 2. taskHash is the one actually committed into the extras digest that
        //    C' binds; agent IDs are pinned by the same human signature.
        bytes32 recomputedExtras = keccak256(abi.encode(agentIdHashes, taskHash));
        if (recomputedExtras != extraFieldsDigest) revert ExtrasDigestMismatch(extraFieldsDigest, recomputedExtras);

        // 3. Chain cross-field consistency (item 48).
        if (id.chainId != p.chainId || id.chainId != DOMAIN_CHAIN_ID) {
            revert ChainIdMismatch(id.chainId, p.chainId, DOMAIN_CHAIN_ID);
        }

        // 4. Decimal value <-> atomic quantity (item 49).
        uint256 expectedAtomic = parseUnits6(p.value);
        if (p.valueAtomic != expectedAtomic) revert AmountMismatch(p.value, p.valueAtomic, expectedAtomic);

        // 5. Existing binding-integrity / replay / predicate policy checks.
        return _consume(id, mandateDigest, predicateId, extraFieldsDigest, p, commitment, nonce);
    }
}
