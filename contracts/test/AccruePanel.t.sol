// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {AccrueJobs} from "../src/AccrueJobs.sol";
import {AccruePanel} from "../src/AccruePanel.sol";

contract AccruePanelTest is Base {
    string internal constant PASS_REPORT = '{"verdict":"pass","checks":[{"label":"Required text","passed":true}]}';
    string internal constant FAIL_REPORT = '{"verdict":"fail","checks":[{"label":"Required text","passed":false}]}';

    // ─── Setup rules ───

    function test_post_storesPanelAndEscrows() public {
        uint256 jobId = _fundedPanelJob();
        AccruePanel.Config memory config = panel.getConfig(jobId);
        assertEq(config.reviewers.length, 3);
        assertEq(config.reviewers[0], engine);
        assertEq(config.threshold, 2);
        assertEq(config.reviewWindow, WINDOW);
        assertEq(config.deliverBy, _deliverBy());
        assertTrue(panel.getState(jobId).configured);
        assertEq(usdc.balanceOf(address(kernel)), BUDGET);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
    }

    function test_panelMustBeEvaluator() public {
        vm.prank(client);
        vm.expectRevert(AccruePanel.NotGoverned.selector);
        kernel.createJob(provider, client, _expiry(), BRIEF, address(panel));
    }

    function test_onlyKernelCallsHooks() public {
        vm.expectRevert(AccruePanel.Unauthorized.selector);
        panel.beforeAction(1, AccrueJobs.fund.selector, "");
        vm.expectRevert(AccruePanel.Unauthorized.selector);
        panel.afterAction(1, AccrueJobs.createJob.selector, "");
    }

    function test_cannotFundWithoutPanel() public {
        vm.startPrank(client);
        uint256 jobId = kernel.createJob(provider, address(panel), _expiry(), BRIEF, address(panel));
        vm.expectRevert(AccruePanel.PanelRequired.selector);
        kernel.setBudget(jobId, BUDGET, "");
        vm.stopPrank();
    }

    function test_invalidPanels() public {
        vm.startPrank(client);
        uint256 jobId = kernel.createJob(provider, address(panel), _expiry(), BRIEF, address(panel));

        address[] memory none = new address[](0);
        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(none, 1));

        address[] memory six = new address[](6);
        for (uint256 i; i < 6; ++i) six[i] = vm.addr(0x1000 + i);
        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(six, 3));

        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(_reviewers3(), 0));
        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(_reviewers3(), 4));

        address[] memory dup = new address[](2);
        dup[0] = alice;
        dup[1] = alice;
        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(dup, 1));

        vm.expectRevert(AccruePanel.ProviderOnPanel.selector);
        kernel.setBudget(jobId, BUDGET, _config(_reviewers1(provider), 1));

        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, abi.encode(_reviewers1(engine), uint8(1), uint32(5 minutes), _deliverBy()));

        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, abi.encode(_reviewers1(engine), uint8(1), WINDOW, uint64(block.timestamp)));

        // Delivery plus review plus the settlement grace must fit before expiry.
        vm.expectRevert(AccruePanel.InvalidPanel.selector);
        kernel.setBudget(jobId, BUDGET, abi.encode(_reviewers1(engine), uint8(1), WINDOW, uint64(_deliverBy() + 1)));
        vm.stopPrank();
    }

    function test_providerCannotRewritePanel() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, address(panel), _expiry(), BRIEF, address(panel));
        vm.prank(client);
        kernel.setBudget(jobId, BUDGET, _config(_reviewers3(), 2));
        vm.prank(provider);
        vm.expectRevert(AccruePanel.Unauthorized.selector);
        kernel.setBudget(jobId, BUDGET, _config(_reviewers1(stranger), 1));
        // A price proposal alone is allowed.
        vm.prank(provider);
        kernel.setBudget(jobId, BUDGET * 2, "");
        assertEq(panel.getConfig(jobId).reviewers.length, 3);
    }

    function test_fundClosedAfterDeliveryDeadline() public {
        vm.startPrank(client);
        uint256 jobId = kernel.createJob(provider, address(panel), _expiry(), BRIEF, address(panel));
        kernel.setBudget(jobId, BUDGET, _config(_reviewers3(), 2));
        vm.warp(_deliverBy());
        vm.expectRevert(AccruePanel.DeliveryClosed.selector);
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
    }

    // ─── Delivery ───

    function test_deliver_putsEvidenceOnChain() public {
        uint256 jobId = _fundedPanelJob();
        vm.expectEmit(true, true, true, true, address(panel));
        emit AccruePanel.Delivered(jobId, provider, keccak256(bytes(EVIDENCE)), EVIDENCE);
        _deliver(jobId);
        AccruePanel.State memory state = panel.getState(jobId);
        assertEq(state.deliveredAt, block.timestamp);
        assertEq(state.deliveredBlock, block.number);
        assertEq(panel.reviewEndsAt(jobId), block.timestamp + WINDOW);
    }

    function test_deliver_evidenceMustMatchHash() public {
        uint256 jobId = _fundedPanelJob();
        vm.startPrank(provider);
        vm.expectRevert(AccruePanel.BadEvidence.selector);
        kernel.submit(jobId, keccak256("something else"), abi.encode(EVIDENCE));
        vm.expectRevert(AccruePanel.BadEvidence.selector);
        kernel.submit(jobId, keccak256(""), "");
        vm.expectRevert(AccruePanel.BadEvidence.selector);
        kernel.submit(jobId, keccak256(""), abi.encode(""));
        vm.stopPrank();
    }

    function test_deliver_lateIsRefused_thenRefunded() public {
        uint256 jobId = _fundedPanelJob();
        vm.warp(_deliverBy() + 1);
        vm.prank(provider);
        vm.expectRevert(AccruePanel.DeliveryClosed.selector);
        kernel.submit(jobId, keccak256(bytes(EVIDENCE)), abi.encode(EVIDENCE));

        uint256 before = usdc.balanceOf(client);
        vm.prank(stranger);
        panel.refundUndelivered(jobId);
        assertEq(usdc.balanceOf(client), before + BUDGET);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Rejected));
        assertEq(kernel.getTimeline(jobId).reason, panel.NO_DELIVERY());
    }

    function test_refundUndelivered_notBeforeDeadline() public {
        uint256 jobId = _fundedPanelJob();
        vm.warp(_deliverBy());
        vm.expectRevert(AccruePanel.DeliveryOpen.selector);
        panel.refundUndelivered(jobId);
        _deliver(jobId); // delivering at the deadline still counts
        vm.warp(_deliverBy() + 1);
        vm.expectRevert(AccruePanel.WrongStatus.selector);
        panel.refundUndelivered(jobId);
    }

    // ─── Votes ───

    function test_twoOfThreePass_paysProvider() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.prank(engine);
        panel.vote(jobId, true, PASS_REPORT);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Submitted));
        vm.prank(alice);
        panel.vote(jobId, true, "Looks right to me");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Completed));
        assertEq(usdc.balanceOf(provider), BUDGET);
        assertEq(kernel.getTimeline(jobId).reason, keccak256("Looks right to me"));
        // The decided job takes no more votes.
        vm.prank(bob);
        vm.expectRevert(AccruePanel.WrongStatus.selector);
        panel.vote(jobId, false, "late");
    }

    function test_twoFails_refundClient() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        uint256 before = usdc.balanceOf(client);
        vm.prank(engine);
        panel.vote(jobId, false, FAIL_REPORT);
        vm.prank(bob);
        panel.vote(jobId, false, "The badge is not there");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Rejected));
        assertEq(usdc.balanceOf(client), before + BUDGET);
    }

    function test_splitVoteWaitsForTheDecider() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.prank(engine);
        panel.vote(jobId, false, FAIL_REPORT);
        vm.prank(alice);
        panel.vote(jobId, true, "fine");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Submitted));
        vm.prank(bob);
        panel.vote(jobId, true, "fine too");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Completed));
    }

    function test_voteRules() public {
        uint256 jobId = _fundedPanelJob();
        vm.prank(engine);
        vm.expectRevert(AccruePanel.WrongStatus.selector);
        panel.vote(jobId, true, PASS_REPORT);
        _deliver(jobId);
        vm.prank(stranger);
        vm.expectRevert(AccruePanel.NotReviewer.selector);
        panel.vote(jobId, true, PASS_REPORT);
        vm.prank(client);
        vm.expectRevert(AccruePanel.NotReviewer.selector);
        panel.vote(jobId, true, PASS_REPORT);
        vm.startPrank(engine);
        vm.expectRevert(AccruePanel.BadReport.selector);
        panel.vote(jobId, true, "");
        panel.vote(jobId, false, FAIL_REPORT);
        vm.expectRevert(AccruePanel.AlreadyVoted.selector);
        panel.vote(jobId, true, PASS_REPORT);
        vm.stopPrank();
        AccruePanel.Vote memory ballot = panel.getVote(jobId, engine);
        assertEq(ballot.choice, 2);
        assertEq(ballot.reportHash, keccak256(bytes(FAIL_REPORT)));
        assertEq(ballot.blockNumber, block.number);
    }

    function test_votesCloseWithTheWindow() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        vm.expectRevert(AccruePanel.ReviewClosed.selector);
        panel.vote(jobId, false, "too late");
    }

    function test_singleReviewer_engineDecides() public {
        vm.prank(client);
        uint256 jobId = kernel.createAndFund(_newJob(_reviewers1(engine), 1));
        _deliver(jobId);
        vm.prank(engine);
        panel.vote(jobId, true, PASS_REPORT);
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    function test_singleReviewer_failRefunds() public {
        vm.prank(client);
        uint256 jobId = kernel.createAndFund(_newJob(_reviewers1(engine), 1));
        _deliver(jobId);
        vm.prank(engine);
        panel.vote(jobId, false, FAIL_REPORT);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Rejected));
    }

    function test_unanimousPanel_oneFailRejects() public {
        vm.prank(client);
        uint256 jobId = kernel.createAndFund(_newJob(_reviewers3(), 3));
        _deliver(jobId);
        vm.prank(alice);
        panel.vote(jobId, false, "no");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Rejected));
    }

    // ─── Silence ───

    function test_silencePays() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.expectRevert(AccruePanel.ReviewOpen.selector);
        panel.settle(jobId);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(stranger);
        panel.settle(jobId);
        assertEq(usdc.balanceOf(provider), BUDGET);
        assertEq(kernel.getTimeline(jobId).reason, panel.SILENCE());
    }

    function test_oneFailIsNotAQuorum_silenceStillPays() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.prank(bob);
        panel.vote(jobId, false, "I don't like it");
        vm.warp(block.timestamp + WINDOW);
        panel.settle(jobId);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Completed));
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    function test_silenceCanSettleBeforeAnyoneCanRefund() public {
        uint256 jobId = _fundedPanelJob();
        uint64 deadline = panel.getConfig(jobId).deliverBy;
        vm.warp(deadline); // deliver at the last moment
        _deliver(jobId);
        vm.warp(deadline + WINDOW);
        // Expiry is still a full grace period away.
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.claimRefund(jobId);
        panel.settle(jobId);
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    // ─── Cancellation ───

    function test_mutualCancelRefunds() public {
        uint256 jobId = _fundedPanelJob();
        vm.prank(stranger);
        vm.expectRevert(AccruePanel.NotParty.selector);
        panel.cancel(jobId);
        vm.prank(client);
        panel.cancel(jobId);
        vm.prank(client);
        vm.expectRevert(AccruePanel.AlreadyConsented.selector);
        panel.cancel(jobId);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
        uint256 before = usdc.balanceOf(client);
        vm.prank(provider);
        panel.cancel(jobId);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Rejected));
        assertEq(usdc.balanceOf(client), before + BUDGET);
        assertEq(kernel.getTimeline(jobId).reason, panel.CANCELLED());
    }

    function test_clientAloneCannotCancelDeliveredWork() public {
        uint256 jobId = _fundedPanelJob();
        _deliver(jobId);
        vm.prank(client);
        panel.cancel(jobId);
        vm.prank(client);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.reject(jobId, bytes32(0), "");
        vm.warp(block.timestamp + WINDOW);
        panel.settle(jobId);
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    // ─── Open jobs ───

    function _openJob() internal returns (uint256 jobId) {
        AccrueJobs.NewJob memory p = _newJob(_reviewers3(), 2);
        p.provider = address(0);
        vm.prank(client);
        jobId = kernel.createWithBudget(p);
    }

    function test_openJob_applyAssignDeliver() public {
        uint256 jobId = _openJob();
        assertEq(usdc.balanceOf(address(kernel)), 0);
        vm.prank(provider);
        panel.applyToJob(jobId, "I can do this today");
        vm.prank(stranger);
        panel.applyToJob(jobId, "");
        AccruePanel.Application[] memory apps = panel.getApplications(jobId);
        assertEq(apps.length, 2);
        assertEq(apps[0].applicant, provider);
        assertTrue(panel.hasApplied(jobId, stranger));

        vm.prank(provider);
        vm.expectRevert(AccruePanel.CannotApply.selector);
        panel.applyToJob(jobId, "again");
        vm.prank(client);
        vm.expectRevert(AccruePanel.CannotApply.selector);
        panel.applyToJob(jobId, "me");
        vm.prank(alice);
        vm.expectRevert(AccruePanel.ProviderOnPanel.selector);
        panel.applyToJob(jobId, "reviewer");

        vm.prank(client);
        kernel.assignAndFund(jobId, provider, BUDGET, "", "");
        assertEq(usdc.balanceOf(address(kernel)), BUDGET);
        vm.prank(stranger);
        vm.expectRevert(AccruePanel.CannotApply.selector);
        panel.applyToJob(jobId, "too late");

        _deliver(jobId);
        vm.prank(engine);
        panel.vote(jobId, true, PASS_REPORT);
        vm.prank(bob);
        panel.vote(jobId, true, "ok");
        assertEq(usdc.balanceOf(provider), BUDGET);
    }

    function test_openJob_cannotAssignAReviewer() public {
        uint256 jobId = _openJob();
        vm.prank(client);
        vm.expectRevert(AccruePanel.ProviderOnPanel.selector);
        kernel.assignAndFund(jobId, alice, BUDGET, "", "");
    }

    function test_onlyGovernedJobsUsePanelFunctions() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, client, block.timestamp + 7 days, BRIEF, address(0));
        vm.expectRevert(AccruePanel.NotGoverned.selector);
        panel.settle(jobId);
        vm.expectRevert(AccruePanel.NotGoverned.selector);
        panel.applyToJob(jobId, "");
    }

    function test_encodeConfigMatches() public view {
        address[] memory r = _reviewers3();
        assertEq(panel.encodeConfig(r, 2, WINDOW, _deliverBy()), _config(r, 2));
    }

    function test_graceMirror() public view {
        assertEq(panel.SETTLE_GRACE(), GRACE);
    }

    function test_supportsInterface() public view {
        assertTrue(panel.supportsInterface(0x01ffc9a7));
        assertFalse(panel.supportsInterface(0xffffffff));
    }
}
