// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CrossLayerBindingValidator} from "../src/CrossLayerBindingValidator.sol";

contract CrossLayerBindingValidatorTest is Test {
    CrossLayerBindingValidator private v;

    bytes32 private constant TRACE_ID = keccak256("trace-1");
    bytes32 private constant CERT = keccak256("cert");
    bytes32 private constant ROOT = keccak256("root");
    bytes32 private constant TX_HASH = bytes32("0xtx");

    event ValidationRecorded(bytes32 indexed traceId, bytes32 certificateHash, bool result);

    function setUp() public {
        v = new CrossLayerBindingValidator();
    }

    function test_RecordAndRead() public {
        v.recordValidation(TRACE_ID, CERT, true, ROOT, TX_HASH);
        (bytes32 cert, bool result, bytes32 root, bytes32 txh, uint256 ts) = v.getValidation(TRACE_ID);
        assertEq(cert, CERT);
        assertTrue(result);
        assertEq(root, ROOT);
        assertEq(txh, TX_HASH);
        assertGt(ts, 0);
    }

    function test_RecordEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ValidationRecorded(TRACE_ID, CERT, true);
        v.recordValidation(TRACE_ID, CERT, true, ROOT, TX_HASH);
    }

    function test_OneEntryPerTrace() public {
        v.recordValidation(TRACE_ID, CERT, true, ROOT, TX_HASH);
        vm.expectRevert(CrossLayerBindingValidator.AlreadyValidated.selector);
        v.recordValidation(TRACE_ID, keccak256("cert2"), true, ROOT, TX_HASH);
    }

    function test_UnrecordedTraceReadsZero() public view {
        (bytes32 cert, bool result, , , uint256 ts) = v.getValidation(keccak256("never"));
        assertEq(cert, bytes32(0));
        assertEq(result, false);
        assertEq(ts, 0);
    }
}
