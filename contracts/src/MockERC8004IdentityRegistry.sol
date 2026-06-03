// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockERC8004IdentityRegistry
/// @notice Practical v1 stand-in for an ERC-8004 Identity Registry. Mirrors the
///         off-chain erc8004-adapter record so the adapter can be repointed at a
///         real registry without changing service code. Label as a mock in UI/docs.
contract MockERC8004IdentityRegistry {
    enum Status {
        UNKNOWN,
        ACTIVE,
        SUSPENDED,
        REVOKED
    }

    struct Agent {
        address owner;
        string agentURI;
        Status status;
        bool exists;
    }

    mapping(string => Agent) private agents;
    mapping(string => address[]) private signingKeys;
    mapping(string => address[]) private paymentKeys;
    mapping(string => mapping(address => bool)) private isSigningKey;
    mapping(string => mapping(address => bool)) private isPaymentKey;

    event AgentRegistered(string indexed agentId, address indexed owner, string agentURI);
    event PaymentKeyAuthorized(string indexed agentId, address indexed key);
    event SigningKeyAuthorized(string indexed agentId, address indexed key);
    event StatusChanged(string indexed agentId, Status status);

    error AgentExists(string agentId);
    error AgentMissing(string agentId);
    error NotOwner(string agentId);

    modifier onlyOwner(string calldata agentId) {
        if (!agents[agentId].exists) revert AgentMissing(agentId);
        if (agents[agentId].owner != msg.sender) revert NotOwner(agentId);
        _;
    }

    function registerAgent(
        string calldata agentId,
        string calldata agentURI,
        address[] calldata initialSigningKeys,
        address[] calldata initialPaymentKeys
    ) external {
        if (agents[agentId].exists) revert AgentExists(agentId);

        agents[agentId] = Agent({owner: msg.sender, agentURI: agentURI, status: Status.ACTIVE, exists: true});

        for (uint256 i = 0; i < initialSigningKeys.length; i++) {
            _addSigningKey(agentId, initialSigningKeys[i]);
        }
        for (uint256 i = 0; i < initialPaymentKeys.length; i++) {
            _addPaymentKey(agentId, initialPaymentKeys[i]);
        }

        emit AgentRegistered(agentId, msg.sender, agentURI);
    }

    function authorizePaymentKey(string calldata agentId, address key) external onlyOwner(agentId) {
        _addPaymentKey(agentId, key);
        emit PaymentKeyAuthorized(agentId, key);
    }

    function authorizeSigningKey(string calldata agentId, address key) external onlyOwner(agentId) {
        _addSigningKey(agentId, key);
        emit SigningKeyAuthorized(agentId, key);
    }

    function setStatus(string calldata agentId, Status status) external onlyOwner(agentId) {
        agents[agentId].status = status;
        emit StatusChanged(agentId, status);
    }

    function getAgent(string calldata agentId)
        external
        view
        returns (address owner, string memory agentURI, Status status)
    {
        if (!agents[agentId].exists) revert AgentMissing(agentId);
        Agent storage agent = agents[agentId];
        return (agent.owner, agent.agentURI, agent.status);
    }

    function getAuthorizedPaymentKeys(string calldata agentId) external view returns (address[] memory) {
        return paymentKeys[agentId];
    }

    function getAuthorizedSigningKeys(string calldata agentId) external view returns (address[] memory) {
        return signingKeys[agentId];
    }

    function isPaymentKeyAuthorized(string calldata agentId, address key) external view returns (bool) {
        return isPaymentKey[agentId][key];
    }

    function _addPaymentKey(string calldata agentId, address key) private {
        if (!isPaymentKey[agentId][key]) {
            isPaymentKey[agentId][key] = true;
            paymentKeys[agentId].push(key);
        }
    }

    function _addSigningKey(string calldata agentId, address key) private {
        if (!isSigningKey[agentId][key]) {
            isSigningKey[agentId][key] = true;
            signingKeys[agentId].push(key);
        }
    }
}
