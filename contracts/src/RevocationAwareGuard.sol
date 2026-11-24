// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title RevocationAwareGuard
/// @notice RCLB settlement guard. A cryptographically valid CLB commitment C
///         (or C') stays valid after identity-key or mandate revocation. This
///         guard re-binds it to the CURRENT authority state at execution time:
///
///           C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N))
///
///         Byte-exact parity with clb-core `computeRevocationAwareCommitment`:
///         abi.encode(bytes32 C, uint256 E_I, uint256 E_M, uint64 T_expiry,
///         bytes32 N). `T_expiry` is INCLUSIVE. `N` is a 32-byte single-use
///         application nonce; the payment nonce remains keccak256(C_t).
///
///         Acceptance requires E_I == current E_I, E_M == current E_M,
///         block.timestamp <= T_expiry, and N unconsumed. Epoch checks run
///         BEFORE nonce consumption, so a revocation that lands between a
///         pre-check and the settlement call wins the race and consumes nothing.
///
/// @dev DEMO authority registry and caveat enforcer, not a production
///      delegation implementation. Authority updates are restricted to a single
///      configured address; see DECISIONS.md for the ERC-7710 caveat caveat.
contract RevocationAwareGuard {
    struct RevocationAwareCommitment {
        bytes32 baseCommitment; // C or C' from clb-core
        uint256 identityEpoch; // E_I bound at signing time
        uint256 mandateEpoch; // E_M bound at signing time
        uint64 expiry; // T_expiry, inclusive Unix seconds
        bytes32 nonce; // N, single-use application nonce
    }

    address public immutable authority;

    mapping(bytes32 agentIdHash => uint256) public identityEpoch;
    mapping(bytes32 agentIdHash => uint256) public mandateEpoch;
    mapping(bytes32 agentIdHash => address) public currentSigningKey;
    mapping(bytes32 agentIdHash => bool) public initialized;
    mapping(bytes32 nonce => bool) public consumed;

    error AuthorityStateUnavailable(bytes32 agentIdHash);
    error UnauthorizedAuthority(address caller);
    error InvalidIdentityKey(address key);
    error IdentityEpochStale(uint256 expected, uint256 provided);
    error MandateEpochStale(uint256 expected, uint256 provided);
    error CommitmentExpired(uint64 expiry);
    error CommitmentMismatch(bytes32 expected, bytes32 provided);
    error NonceMismatch(bytes32 expected, bytes32 provided);
    error NonceAlreadyConsumed(bytes32 nonce);

    event AuthorityEpochsInitialized(bytes32 indexed agentIdHash, uint256 identityEpoch, uint256 mandateEpoch);
    event IdentityRevoked(bytes32 indexed agentIdHash, uint256 identityEpoch);
    event MandateRevoked(bytes32 indexed agentIdHash, uint256 mandateEpoch);
    event IdentityKeyRotated(bytes32 indexed agentIdHash, address indexed newKey, uint256 identityEpoch);
    event RevocationAwareSettlementConsumed(bytes32 indexed nonce, bytes32 indexed commitment, bytes32 paymentNonce);

    modifier onlyAuthority() {
        if (msg.sender != authority) revert UnauthorizedAuthority(msg.sender);
        _;
    }

    constructor(address authority_) {
        authority = authority_;
    }

    function _hashAgent(string calldata agentId) private pure returns (bytes32) {
        return keccak256(bytes(agentId));
    }

    /// @notice Install the initial CURRENT epoch state. Epoch 0 is valid; the
    ///         separate `initialized` flag is what makes unknown state fail closed.
    function initializeEpochs(string calldata agentId, uint256 initialIdentityEpoch, uint256 initialMandateEpoch)
        external
        onlyAuthority
    {
        bytes32 idHash = _hashAgent(agentId);
        if (initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        initialized[idHash] = true;
        identityEpoch[idHash] = initialIdentityEpoch;
        mandateEpoch[idHash] = initialMandateEpoch;
        emit AuthorityEpochsInitialized(idHash, initialIdentityEpoch, initialMandateEpoch);
    }

    /// @notice Trusted CURRENT authority snapshot. Reverts (rather than returning
    ///         zeros) when the agent is unknown, so a failed read cannot be
    ///         mistaken for "no revocation".
    function currentEpochs(string calldata agentId) external view returns (uint256, uint256) {
        bytes32 idHash = _hashAgent(agentId);
        if (!initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        return (identityEpoch[idHash], mandateEpoch[idHash]);
    }

    /// @notice Revoke the current identity key: any C_t pinned to the old E_I
    ///         becomes stale immediately.
    function revokeIdentity(string calldata agentId) external onlyAuthority {
        bytes32 idHash = _hashAgent(agentId);
        if (!initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        identityEpoch[idHash] += 1;
        emit IdentityRevoked(idHash, identityEpoch[idHash]);
    }

    /// @notice Revoke the human mandate: any C_t pinned to the old E_M becomes stale.
    function revokeMandate(string calldata agentId) external onlyAuthority {
        bytes32 idHash = _hashAgent(agentId);
        if (!initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        mandateEpoch[idHash] += 1;
        emit MandateRevoked(idHash, mandateEpoch[idHash]);
    }

    /// @notice Rotate the identity key and advance E_I in the same transaction,
    ///         so a commitment signed under the old key cannot survive rotation.
    function rotateIdentityKey(string calldata agentId, address newKey) external onlyAuthority {
        bytes32 idHash = _hashAgent(agentId);
        if (!initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        if (newKey == address(0)) revert InvalidIdentityKey(newKey);
        identityEpoch[idHash] += 1;
        currentSigningKey[idHash] = newKey;
        emit IdentityKeyRotated(idHash, newKey, identityEpoch[idHash]);
    }

    /// @notice C_t = keccak256(abi.encode(C, E_I, E_M, T_expiry, N)).
    function computeRevocationAwareCommitment(RevocationAwareCommitment calldata f)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(f.baseCommitment, f.identityEpoch, f.mandateEpoch, f.expiry, f.nonce));
    }

    /// @notice payment nonce = keccak256(C_t), same derivation as H(C).
    function deriveRevocationAwareNonce(bytes32 commitment) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(commitment));
    }

    /// @notice Settlement entry point. All checks are deterministic and revert
    ///         atomically: a rejected attempt consumes neither N nor its nonce.
    function validateAndConsume(
        string calldata agentId,
        RevocationAwareCommitment calldata f,
        bytes32 commitment,
        bytes32 paymentNonce
    ) external returns (bytes32) {
        bytes32 idHash = _hashAgent(agentId);
        // 1. CURRENT authority state — fail closed on an unknown agent.
        if (!initialized[idHash]) revert AuthorityStateUnavailable(idHash);
        uint256 currentIdentity = identityEpoch[idHash];
        uint256 currentMandate = mandateEpoch[idHash];

        // 2. Revocation checks FIRST: a stale binding cannot burn a nonce.
        if (f.identityEpoch != currentIdentity) revert IdentityEpochStale(currentIdentity, f.identityEpoch);
        if (f.mandateEpoch != currentMandate) revert MandateEpochStale(currentMandate, f.mandateEpoch);

        // 3. Temporal validity, inclusive at T_expiry.
        if (block.timestamp > f.expiry) revert CommitmentExpired(f.expiry);

        // 4. Binding integrity and nonce derivation.
        bytes32 recomputed = computeRevocationAwareCommitment(f);
        if (recomputed != commitment) revert CommitmentMismatch(recomputed, commitment);
        bytes32 expectedPaymentNonce = keccak256(abi.encodePacked(commitment));
        if (expectedPaymentNonce != paymentNonce) revert NonceMismatch(expectedPaymentNonce, paymentNonce);

        // 5. Single-use application nonce.
        if (consumed[f.nonce]) revert NonceAlreadyConsumed(f.nonce);
        consumed[f.nonce] = true;
        emit RevocationAwareSettlementConsumed(f.nonce, commitment, paymentNonce);
        return commitment;
    }
}
