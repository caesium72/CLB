// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgenticAuditAnchor} from "../src/AgenticAuditAnchor.sol";

contract AgenticAuditAnchorTest is Test {
    AgenticAuditAnchor private anchor;

    bytes32 private constant TRACE_ID = keccak256("trace-1");
    bytes32 private constant ROOT = keccak256("merkle-root");
    bytes32 private constant TRACE_HASH = keccak256("trace-hash");

    function setUp() public {
        anchor = new AgenticAuditAnchor();
    }

    function test_AnchorAndRead() public {
        anchor.anchorTrace(TRACE_ID, ROOT, TRACE_HASH, "ipfs://meta");

        (bytes32 root, bytes32 traceHash, string memory uri, address by,) = anchor.getTraceAnchor(TRACE_ID);

        assertEq(root, ROOT);
        assertEq(traceHash, TRACE_HASH);
        assertEq(uri, "ipfs://meta");
        assertEq(by, address(this));
        assertTrue(anchor.isAnchored(TRACE_ID));
    }

    function test_RevertWhen_AnchoredTwice() public {
        anchor.anchorTrace(TRACE_ID, ROOT, TRACE_HASH, "ipfs://meta");
        vm.expectRevert(abi.encodeWithSelector(AgenticAuditAnchor.TraceAlreadyAnchored.selector, TRACE_ID));
        anchor.anchorTrace(TRACE_ID, ROOT, TRACE_HASH, "ipfs://meta");
    }

    function test_RevertWhen_ReadingMissingTrace() public {
        vm.expectRevert(abi.encodeWithSelector(AgenticAuditAnchor.TraceNotAnchored.selector, TRACE_ID));
        anchor.getTraceAnchor(TRACE_ID);
    }
}
