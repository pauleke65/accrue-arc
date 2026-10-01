// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AccrueJobs} from "../src/AccrueJobs.sol";
import {AccruePanel} from "../src/AccruePanel.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Drives random sequences of every public action across many jobs.
contract Handler is Test {
    MockUSDC public usdc;
    AccrueJobs public kernel;
    AccruePanel public panel;

    address public client = makeAddr("h-client");
    address public provider = makeAddr("h-provider");
    address[3] public reviewers = [makeAddr("h-engine"), makeAddr("h-alice"), makeAddr("h-bob")];

    uint256[] public ids;
    mapping(uint256 => uint8) public lastStatus;
    bool public terminalChanged;

    constructor(MockUSDC usdc_, AccrueJobs kernel_, AccruePanel panel_) {
        usdc = usdc_;
        kernel = kernel_;
        panel = panel_;
        usdc.mint(client, 1_000_000e6);
        vm.prank(client);
        usdc.approve(address(kernel), type(uint256).max);
    }

    function post(uint96 budget, uint8 threshold, bool open) external {
        budget = uint96(bound(budget, 1, 10_000e6));
        threshold = uint8(bound(threshold, 1, 3));
        address[] memory panelMembers = new address[](3);
        for (uint256 i; i < 3; ++i) panelMembers[i] = reviewers[i];
        uint64 deliverBy = uint64(block.timestamp + 2 days);
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: open ? address(0) : provider,
            evaluator: address(panel),
            expiredAt: uint256(deliverBy) + 1 days + panel.SETTLE_GRACE(),
            description: "job",
            hook: address(panel),
            budget: budget,
            budgetParams: abi.encode(panelMembers, threshold, uint32(1 days), deliverBy),
            fundParams: ""
        });
        vm.prank(client);
        uint256 id = open ? kernel.createWithBudget(p) : kernel.createAndFund(p);
        ids.push(id);
        _track(id);
    }

    function assign(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        AccrueJobs.Job memory job = kernel.getJob(id);
        vm.prank(client);
        try kernel.assignAndFund(id, provider, job.budget, "", "") {} catch {}
        _track(id);
    }

    function deliver(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        string memory evidence = '{"url":"https://example.com"}';
        vm.prank(provider);
        try kernel.submit(id, keccak256(bytes(evidence)), abi.encode(evidence)) {} catch {}
        _track(id);
    }

    function vote(uint256 seed, uint8 who, bool pass) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        vm.prank(reviewers[who % 3]);
        try panel.vote(id, pass, "report") {} catch {}
        _track(id);
    }

    function settle(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        try panel.settle(id) {} catch {}
        try panel.refundUndelivered(id) {} catch {}
        try kernel.claimRefund(id) {} catch {}
        _track(id);
    }

    function cancel(uint256 seed, bool byClient) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        vm.prank(byClient ? client : provider);
        try panel.cancel(id) {} catch {}
        _track(id);
    }

    function wait(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1, 3 days));
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) private view returns (uint256) {
        if (ids.length == 0) return 0;
        return ids[seed % ids.length];
    }

    function _track(uint256 id) private {
        uint8 status = uint8(kernel.getJob(id).status);
        uint8 previous = lastStatus[id];
        // Completed, Rejected and Expired (3, 4, 5) are final.
        if (previous >= 3 && status != previous) terminalChanged = true;
        lastStatus[id] = status;
    }
}

contract InvariantsTest is StdInvariant, Test {
    MockUSDC internal usdc;
    AccrueJobs internal kernel;
    AccruePanel internal panel;
    Handler internal handler;
    uint256 internal supply;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        kernel = new AccrueJobs(address(usdc));
        panel = new AccruePanel(kernel);
        handler = new Handler(usdc, kernel, panel);
        supply = usdc.totalSupply();
        targetContract(address(handler));
    }

    /// The kernel holds exactly the budgets of jobs that are funded and undecided.
    function invariant_escrowEqualsOpenBudgets() public view {
        uint256 owed;
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            AccrueJobs.Job memory job = kernel.getJob(handler.ids(i));
            if (job.status == AccrueJobs.JobStatus.Funded || job.status == AccrueJobs.JobStatus.Submitted) {
                owed += job.budget;
            }
        }
        assertEq(usdc.balanceOf(address(kernel)), owed);
    }

    /// No USDC is created or lost: it is with the client, the provider or in escrow.
    function invariant_moneyIsConserved() public view {
        assertEq(
            usdc.balanceOf(handler.client()) + usdc.balanceOf(handler.provider()) + usdc.balanceOf(address(kernel)),
            supply
        );
    }

    function invariant_finalStatesAreFinal() public view {
        assertFalse(handler.terminalChanged());
    }
}
