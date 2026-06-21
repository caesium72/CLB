// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * MaliciousToken: ERC20 with transfer fee (deflationary token)
 *
 * When used as a payment token in x402, the recipient receives LESS than
 * the authorized amount. The payer signs authorization for 100, but the
 * recipient only gets 95 (5% fee burned/stolen by the token contract).
 *
 * This breaks the x402 payment guarantee:
 *   - Payer authorized: 100 tokens
 *   - Server expects: 100 tokens
 *   - Server receives: 95 tokens
 *   - 5 tokens "disappeared" (fee)
 */
contract FeeToken {
    string public constant name = "Fee Token";
    string public constant symbol = "FEE";
    uint8 public constant decimals = 6;

    uint256 public constant FEE_BPS = 500; // 5% fee
    address public feeCollector;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    uint256 public totalSupply;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor(address _feeCollector) {
        feeCollector = _feeCollector;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transferWithFee(msg.sender, to, amount);
    }

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp > validAfter, "Not yet valid");
        require(block.timestamp < validBefore, "Expired");
        require(!authorizationState[from][nonce], "Already used");

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        ));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == from, "Invalid sig");

        authorizationState[from][nonce] = true;

        // MALICIOUS: Apply fee during transfer
        _transferWithFee(from, to, value);

        emit AuthorizationUsed(from, nonce);
    }

    function _transferWithFee(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");

        uint256 fee = (amount * FEE_BPS) / 10000;
        uint256 netAmount = amount - fee;

        balanceOf[from] -= amount;
        balanceOf[to] += netAmount;

        if (fee > 0) {
            balanceOf[feeCollector] += fee;
            emit Transfer(from, feeCollector, fee);
        }

        emit Transfer(from, to, netAmount);
        return true;
    }
}

/**
 * ReentrantToken: ERC20 with callback in transferWithAuthorization
 *
 * Calls back into the caller during transfer, enabling reentrancy attacks.
 */
contract ReentrantToken {
    string public constant name = "Reentrant Token";
    string public constant symbol = "REENT";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    uint256 public totalSupply;

    address public callbackTarget;
    bytes public callbackData;

    bytes32 public DOMAIN_SEPARATOR;
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp > validAfter, "Not yet valid");
        require(block.timestamp < validBefore, "Expired");
        require(!authorizationState[from][nonce], "Already used");

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01", DOMAIN_SEPARATOR,
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce))
        ));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == from, "Invalid sig");

        authorizationState[from][nonce] = true;

        // Transfer
        require(balanceOf[from] >= value, "Insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;

        // MALICIOUS: Callback during transfer
        if (callbackTarget != address(0)) {
            (bool success, ) = callbackTarget.call(callbackData);
            // Silently ignore callback failure
        }

        emit Transfer(from, to, value);
    }
}
