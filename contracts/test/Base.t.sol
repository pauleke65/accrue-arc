// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AccrueJobs} from "../src/AccrueJobs.sol";
import {AccruePanel} from "../src/AccruePanel.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

abstract contract Base is Test {
    MockUSDC internal usdc;
    AccrueJobs internal kernel;
    AccruePanel internal panel;

    uint256 internal clientKey = 0xC11E47;
    address internal client;
    address internal provider = makeAddr("provider");
    address internal engine = makeAddr("proof-engine");
    address internal alice = makeAddr("reviewer-alice");
    address internal bob = makeAddr("reviewer-bob");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant BUDGET = 25e6; // 25 USDC, 6 decimals
    uint32 internal constant WINDOW = 1 days;
    /// Mirrors AccruePanel.SETTLE_GRACE. Helpers must not make external calls:
    /// one inside a pranked call's arguments would use up the prank.
    uint256 internal constant GRACE = 1 days;
    string internal constant BRIEF =
        '{"v":1,"title":"Add the Accrue badge","brief":"Put the badge on the pricing page","check":{"kind":"webpage","requiredText":"Paid on proof"}}';
    string internal constant EVIDENCE = '{"v":1,"url":"https://example.com/pricing","notes":"Badge is in the footer"}';

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        client = vm.addr(clientKey);
        usdc = new MockUSDC();
        kernel = new AccrueJobs(address(usdc));
        panel = new AccruePanel(kernel);
        usdc.mint(client, 1_000e6);
        vm.prank(client);
        usdc.approve(address(kernel), type(uint256).max);
    }

    function _deliverBy() internal view returns (uint64) {
        return uint64(block.timestamp + 3 days);
    }

    function _expiry() internal view returns (uint256) {
        return uint256(_deliverBy()) + WINDOW + GRACE;
    }

    function _reviewers1(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _reviewers3() internal view returns (address[] memory r) {
        r = new address[](3);
        r[0] = engine;
        r[1] = alice;
        r[2] = bob;
    }

    function _config(address[] memory reviewers, uint8 threshold) internal view returns (bytes memory) {
        return abi.encode(reviewers, threshold, WINDOW, _deliverBy());
    }

    function _newJob(address[] memory reviewers, uint8 threshold) internal view returns (AccrueJobs.NewJob memory) {
        return AccrueJobs.NewJob({
            provider: provider,
            evaluator: address(panel),
            expiredAt: _expiry(),
            description: BRIEF,
            hook: address(panel),
            budget: BUDGET,
            budgetParams: _config(reviewers, threshold),
            fundParams: ""
        });
    }

    /// A funded panel job: Proof Engine plus two people, two of three must agree.
    function _fundedPanelJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = kernel.createAndFund(_newJob(_reviewers3(), 2));
    }

    function _deliver(uint256 jobId) internal {
        vm.prank(provider);
        kernel.submit(jobId, keccak256(bytes(EVIDENCE)), abi.encode(EVIDENCE));
    }

    function _status(uint256 jobId) internal view returns (AccrueJobs.JobStatus) {
        return kernel.getJob(jobId).status;
    }
}
