// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {AccrueJobs} from "../src/AccrueJobs.sol";
import {IACPHook} from "../src/interfaces/IACPHook.sol";

/// Records every hook call so tests can assert order and payloads.
contract RecordingHook is IACPHook {
    struct Call {
        bool before;
        uint256 jobId;
        bytes4 selector;
        bytes data;
    }

    Call[] public calls;
    bool public revertOnSubmit;

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IACPHook).interfaceId;
    }

    function setRevertOnSubmit(bool value) external {
        revertOnSubmit = value;
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        if (revertOnSubmit && selector == AccrueJobs.submit.selector) revert("hook says no");
        calls.push(Call(true, jobId, selector, data));
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        calls.push(Call(false, jobId, selector, data));
    }

    function count() external view returns (uint256) {
        return calls.length;
    }

    function selectorAt(uint256 i) external view returns (bool, bytes4) {
        return (calls[i].before, calls[i].selector);
    }

    function dataAt(uint256 i) external view returns (bytes memory) {
        return calls[i].data;
    }
}

/// Tries to call back into the kernel from inside a hook.
contract ReentrantHook is IACPHook {
    AccrueJobs public kernel;

    constructor(AccrueJobs k) {
        kernel = k;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IACPHook).interfaceId;
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata) external {
        if (selector == AccrueJobs.fund.selector) kernel.claimRefund(jobId);
    }

    function afterAction(uint256, bytes4, bytes calldata) external {}
}

/// Burns all the gas it is given.
contract GasHogHook is IACPHook {
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IACPHook).interfaceId;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external pure {
        while (true) {}
    }

    function afterAction(uint256, bytes4, bytes calldata) external {}
}

contract NotAHook {}

contract AccrueJobsTest is Base {
    address internal evaluator = makeAddr("evaluator");
    bytes32 internal constant DELIVERABLE = keccak256("work");
    bytes32 internal constant REASON = keccak256("report");

    function _plainJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = kernel.createJob(provider, evaluator, block.timestamp + 7 days, "brief", address(0));
    }

    function _funded() internal returns (uint256 jobId) {
        jobId = _plainJob();
        vm.startPrank(client);
        kernel.setBudget(jobId, BUDGET, "");
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
    }

    // ─── createJob ───

    function test_createJob_recordsEverything() public {
        uint256 jobId = _plainJob();
        AccrueJobs.Job memory job = kernel.getJob(jobId);
        assertEq(jobId, 1);
        assertEq(job.id, 1);
        assertEq(job.client, client);
        assertEq(job.provider, provider);
        assertEq(job.evaluator, evaluator);
        assertEq(job.description, "brief");
        assertEq(job.budget, 0);
        assertEq(uint8(job.status), uint8(AccrueJobs.JobStatus.Open));
        AccrueJobs.Timeline memory t = kernel.getTimeline(jobId);
        assertEq(t.createdAt, block.timestamp);
        assertEq(t.createdBlock, block.number);
    }

    function test_createJob_rejectsBadInput() public {
        vm.startPrank(client);
        vm.expectRevert(AccrueJobs.ZeroAddress.selector);
        kernel.createJob(provider, address(0), block.timestamp + 1 days, "b", address(0));
        vm.expectRevert(AccrueJobs.ExpiryTooShort.selector);
        kernel.createJob(provider, evaluator, block.timestamp + 5 minutes, "b", address(0));
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.createJob(client, evaluator, block.timestamp + 1 days, "b", address(0));
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.createJob(evaluator, evaluator, block.timestamp + 1 days, "b", address(0));
        vm.expectRevert(AccrueJobs.DescriptionTooLong.selector);
        kernel.createJob(provider, evaluator, block.timestamp + 1 days, string(new bytes(4097)), address(0));
        address notAHook = address(new NotAHook());
        vm.expectRevert(AccrueJobs.HookNotSupported.selector);
        kernel.createJob(provider, evaluator, block.timestamp + 1 days, "b", notAHook);
        vm.expectRevert(AccrueJobs.HookNotSupported.selector);
        kernel.createJob(provider, evaluator, block.timestamp + 1 days, "b", stranger);
        vm.stopPrank();
    }

    function test_createJob_evaluatorMayBeClient() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, client, block.timestamp + 1 days, "b", address(0));
        assertEq(kernel.getJob(jobId).evaluator, client);
    }

    // ─── setProvider / setBudget ───

    function test_setProvider_onlyClientOnlyOnce() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(address(0), evaluator, block.timestamp + 1 days, "b", address(0));
        vm.prank(stranger);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.setProvider(jobId, provider, "");
        vm.startPrank(client);
        vm.expectRevert(AccrueJobs.ZeroAddress.selector);
        kernel.setProvider(jobId, address(0), "");
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.setProvider(jobId, evaluator, "");
        kernel.setProvider(jobId, provider, "");
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.setProvider(jobId, stranger, "");
        vm.stopPrank();
        assertEq(kernel.getJob(jobId).provider, provider);
    }

    function test_setBudget_clientOrProviderWhileOpen() public {
        uint256 jobId = _plainJob();
        vm.prank(provider);
        kernel.setBudget(jobId, 30e6, "");
        assertEq(kernel.getJob(jobId).budget, 30e6);
        vm.prank(client);
        kernel.setBudget(jobId, BUDGET, "");
        vm.prank(stranger);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.setBudget(jobId, 1, "");
        vm.prank(client);
        kernel.fund(jobId, BUDGET, "");
        vm.prank(client);
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.setBudget(jobId, 1, "");
    }

    // ─── fund ───

    function test_fund_escrowsExactBudget() public {
        uint256 before = usdc.balanceOf(client);
        uint256 jobId = _funded();
        assertEq(usdc.balanceOf(address(kernel)), BUDGET);
        assertEq(usdc.balanceOf(client), before - BUDGET);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
        assertEq(kernel.getTimeline(jobId).fundedBlock, block.number);
    }

    function test_fund_guardsAgainstPriceChanges() public {
        uint256 jobId = _plainJob();
        vm.prank(client);
        kernel.setBudget(jobId, BUDGET, "");
        // The provider raises the price just before the client funds.
        vm.prank(provider);
        kernel.setBudget(jobId, BUDGET * 4, "");
        vm.prank(client);
        vm.expectRevert(AccrueJobs.BudgetMismatch.selector);
        kernel.fund(jobId, BUDGET, "");
    }

    function test_fund_requirements() public {
        vm.prank(client);
        uint256 open = kernel.createJob(address(0), evaluator, block.timestamp + 1 days, "b", address(0));
        vm.prank(client);
        kernel.setBudget(open, BUDGET, "");
        vm.prank(client);
        vm.expectRevert(AccrueJobs.ProviderNotSet.selector);
        kernel.fund(open, BUDGET, "");

        uint256 jobId = _plainJob();
        vm.prank(client);
        vm.expectRevert(AccrueJobs.ZeroBudget.selector);
        kernel.fund(jobId, 0, "");
        vm.prank(client);
        kernel.setBudget(jobId, BUDGET, "");
        vm.prank(provider);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.fund(jobId, BUDGET, "");
        vm.warp(block.timestamp + 7 days);
        vm.prank(client);
        vm.expectRevert(AccrueJobs.JobExpiredAlready.selector);
        kernel.fund(jobId, BUDGET, "");
    }

    // ─── submit / complete / reject ───

    function test_happyPath_paysProvider() public {
        uint256 jobId = _funded();
        vm.prank(provider);
        kernel.submit(jobId, DELIVERABLE, "");
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Submitted));
        assertEq(kernel.getTimeline(jobId).deliverable, DELIVERABLE);

        vm.expectEmit(true, true, false, true, address(kernel));
        emit AccrueJobs.PaymentReleased(jobId, provider, BUDGET);
        vm.prank(evaluator);
        kernel.complete(jobId, REASON, "");

        assertEq(usdc.balanceOf(provider), BUDGET);
        assertEq(usdc.balanceOf(address(kernel)), 0);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Completed));
        assertEq(kernel.getTimeline(jobId).reason, REASON);
    }

    function test_submit_rules() public {
        uint256 jobId = _plainJob();
        vm.prank(provider);
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.submit(jobId, DELIVERABLE, "");
        jobId = _funded();
        vm.prank(stranger);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.submit(jobId, DELIVERABLE, "");
        vm.prank(provider);
        vm.expectRevert(AccrueJobs.EmptyDeliverable.selector);
        kernel.submit(jobId, bytes32(0), "");
        vm.warp(block.timestamp + 7 days);
        vm.prank(provider);
        vm.expectRevert(AccrueJobs.JobExpiredAlready.selector);
        kernel.submit(jobId, DELIVERABLE, "");
    }

    function test_complete_onlyEvaluatorOnlySubmitted() public {
        uint256 jobId = _funded();
        vm.prank(evaluator);
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.complete(jobId, REASON, "");
        vm.prank(provider);
        kernel.submit(jobId, DELIVERABLE, "");
        vm.prank(client);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.complete(jobId, REASON, "");
        vm.prank(provider);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.complete(jobId, REASON, "");
    }

    function test_reject_whoAndWhen() public {
        // Open: only the client, nothing to refund.
        uint256 open = _plainJob();
        vm.prank(evaluator);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.reject(open, REASON, "");
        vm.prank(client);
        kernel.reject(open, REASON, "");
        assertEq(uint8(_status(open)), uint8(AccrueJobs.JobStatus.Rejected));

        // Funded: only the evaluator; the client cannot pull funds back alone.
        uint256 jobId = _funded();
        vm.prank(client);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.reject(jobId, REASON, "");
        uint256 before = usdc.balanceOf(client);
        vm.prank(evaluator);
        kernel.reject(jobId, REASON, "");
        assertEq(usdc.balanceOf(client), before + BUDGET);

        // Terminal states stay terminal.
        vm.prank(evaluator);
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.reject(jobId, REASON, "");
    }

    function test_reject_submittedRefundsClient() public {
        uint256 jobId = _funded();
        vm.prank(provider);
        kernel.submit(jobId, DELIVERABLE, "");
        uint256 before = usdc.balanceOf(client);
        vm.prank(evaluator);
        kernel.reject(jobId, REASON, "");
        assertEq(usdc.balanceOf(client), before + BUDGET);
        assertEq(usdc.balanceOf(provider), 0);
    }

    // ─── claimRefund ───

    function test_claimRefund_afterExpiryByAnyone() public {
        uint256 jobId = _funded();
        vm.prank(stranger);
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.claimRefund(jobId);
        vm.warp(block.timestamp + 7 days);
        uint256 before = usdc.balanceOf(client);
        vm.prank(stranger);
        kernel.claimRefund(jobId);
        assertEq(usdc.balanceOf(client), before + BUDGET);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Expired));
        vm.expectRevert(AccrueJobs.WrongStatus.selector);
        kernel.claimRefund(jobId);
    }

    function test_claimRefund_worksEvenWhenHookReverts() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, evaluator, block.timestamp + 7 days, "b", address(hook));
        vm.startPrank(client);
        kernel.setBudget(jobId, BUDGET, "");
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
        hook.setRevertOnSubmit(true);
        vm.prank(provider);
        vm.expectRevert("hook says no");
        kernel.submit(jobId, DELIVERABLE, "");
        vm.warp(block.timestamp + 7 days);
        kernel.claimRefund(jobId);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Expired));
    }

    function test_unknownJob() public {
        vm.expectRevert(AccrueJobs.InvalidJob.selector);
        kernel.fund(99, 1, "");
        vm.expectRevert(AccrueJobs.InvalidJob.selector);
        kernel.claimRefund(0);
    }

    // ─── Hooks ───

    function test_hooks_calledInOrderWithCallerFirst() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, evaluator, block.timestamp + 7 days, "b", address(hook));
        vm.startPrank(client);
        kernel.setBudget(jobId, BUDGET, hex"01");
        kernel.fund(jobId, BUDGET, hex"02");
        vm.stopPrank();
        vm.prank(provider);
        kernel.submit(jobId, DELIVERABLE, hex"03");
        vm.prank(evaluator);
        kernel.complete(jobId, REASON, hex"04");

        bytes4[9] memory expected = [
            AccrueJobs.createJob.selector,
            AccrueJobs.setBudget.selector,
            AccrueJobs.setBudget.selector,
            AccrueJobs.fund.selector,
            AccrueJobs.fund.selector,
            AccrueJobs.submit.selector,
            AccrueJobs.submit.selector,
            AccrueJobs.complete.selector,
            AccrueJobs.complete.selector
        ];
        assertEq(hook.count(), 9);
        for (uint256 i; i < 9; ++i) {
            (bool isBefore, bytes4 selector) = hook.selectorAt(i);
            assertEq(selector, expected[i]);
            // createJob only has an after-hook; then each call is before, after.
            assertEq(isBefore, i > 0 && i % 2 == 1);
        }
        (address caller, uint256 amount, bytes memory opt) = abi.decode(hook.dataAt(1), (address, uint256, bytes));
        assertEq(caller, client);
        assertEq(amount, BUDGET);
        assertEq(opt, hex"01");
        (address submitter, bytes32 deliverable,) = abi.decode(hook.dataAt(5), (address, bytes32, bytes));
        assertEq(submitter, provider);
        assertEq(deliverable, DELIVERABLE);
    }

    function test_hooks_cannotReenter() public {
        ReentrantHook hook = new ReentrantHook(kernel);
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, evaluator, block.timestamp + 7 days, "b", address(hook));
        vm.startPrank(client);
        kernel.setBudget(jobId, BUDGET, "");
        vm.expectRevert(AccrueJobs.Reentrancy.selector);
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
    }

    function test_hooks_gasIsCapped() public {
        GasHogHook hook = new GasHogHook();
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, evaluator, block.timestamp + 7 days, "b", address(hook));
        vm.prank(client);
        uint256 gasBefore = gasleft();
        vm.expectRevert();
        kernel.setBudget{gas: 5_000_000}(jobId, BUDGET, "");
        // The hook could only spend its cap, not everything the caller sent.
        assertLt(gasBefore - gasleft(), 2_000_000);
    }

    // ─── Extensions ───

    function test_createAndFund_oneTransaction() public {
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: provider,
            evaluator: evaluator,
            expiredAt: block.timestamp + 7 days,
            description: "b",
            hook: address(0),
            budget: BUDGET,
            budgetParams: "",
            fundParams: ""
        });
        vm.prank(client);
        uint256 jobId = kernel.createAndFund(p);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
        assertEq(usdc.balanceOf(address(kernel)), BUDGET);

        p.provider = address(0);
        vm.prank(client);
        vm.expectRevert(AccrueJobs.ProviderNotSet.selector);
        kernel.createAndFund(p);
    }

    function test_createAndFundWithPermit_noApproveNeeded() public {
        vm.prank(client);
        usdc.approve(address(kernel), 0);
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: provider,
            evaluator: evaluator,
            expiredAt: block.timestamp + 7 days,
            description: "b",
            hook: address(0),
            budget: BUDGET,
            budgetParams: "",
            fundParams: ""
        });
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(BUDGET, deadline);
        vm.prank(client);
        uint256 jobId = kernel.createAndFundWithPermit(p, deadline, v, r, s);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
        assertEq(usdc.allowance(client, address(kernel)), 0);
    }

    function test_permit_frontRunStillFunds() public {
        vm.prank(client);
        usdc.approve(address(kernel), 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(BUDGET, deadline);
        // Someone replays the signature first; the job still funds.
        usdc.permit(client, address(kernel), BUDGET, deadline, v, r, s);
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: provider,
            evaluator: evaluator,
            expiredAt: block.timestamp + 7 days,
            description: "b",
            hook: address(0),
            budget: BUDGET,
            budgetParams: "",
            fundParams: ""
        });
        vm.prank(client);
        uint256 jobId = kernel.createAndFundWithPermit(p, deadline, v, r, s);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
    }

    function test_createWithBudget_thenAssignAndFund() public {
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: address(0),
            evaluator: evaluator,
            expiredAt: block.timestamp + 7 days,
            description: "b",
            hook: address(0),
            budget: BUDGET,
            budgetParams: "",
            fundParams: ""
        });
        vm.prank(client);
        uint256 jobId = kernel.createWithBudget(p);
        assertEq(kernel.getJob(jobId).budget, BUDGET);
        assertEq(usdc.balanceOf(address(kernel)), 0);

        vm.prank(stranger);
        vm.expectRevert(AccrueJobs.Unauthorized.selector);
        kernel.assignAndFund(jobId, provider, BUDGET, "", "");
        vm.prank(client);
        kernel.assignAndFund(jobId, provider, BUDGET, "", "");
        assertEq(kernel.getJob(jobId).provider, provider);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
    }

    function test_assignAndFundWithPermit() public {
        AccrueJobs.NewJob memory p = AccrueJobs.NewJob({
            provider: address(0),
            evaluator: evaluator,
            expiredAt: block.timestamp + 7 days,
            description: "b",
            hook: address(0),
            budget: BUDGET,
            budgetParams: "",
            fundParams: ""
        });
        vm.startPrank(client);
        uint256 jobId = kernel.createWithBudget(p);
        usdc.approve(address(kernel), 0);
        vm.stopPrank();
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(BUDGET, deadline);
        vm.prank(client);
        kernel.assignAndFundWithPermit(jobId, provider, BUDGET, "", "", deadline, v, r, s);
        assertEq(uint8(_status(jobId)), uint8(AccrueJobs.JobStatus.Funded));
    }

    // ─── Token behaviour ───

    function test_blocklistedProvider_cannotBePaid_clientRecoversAfterExpiry() public {
        uint256 jobId = _funded();
        vm.prank(provider);
        kernel.submit(jobId, DELIVERABLE, "");
        usdc.setBlocked(provider, true);
        vm.prank(evaluator);
        vm.expectRevert(AccrueJobs.TransferFailed.selector);
        kernel.complete(jobId, REASON, "");
        vm.warp(block.timestamp + 7 days);
        kernel.claimRefund(jobId);
        assertEq(usdc.balanceOf(address(kernel)), 0);
    }

    function test_fund_withoutAllowanceFails() public {
        uint256 jobId = _plainJob();
        vm.startPrank(client);
        kernel.setBudget(jobId, BUDGET, "");
        usdc.approve(address(kernel), 0);
        vm.expectRevert(AccrueJobs.TransferFailed.selector);
        kernel.fund(jobId, BUDGET, "");
        vm.stopPrank();
    }

    function test_parties_matchesJob() public {
        uint256 jobId = _funded();
        (
            address c,
            address p,
            address e,
            AccrueJobs.JobStatus status,
            uint256 budget,
            uint256 expiredAt,
            address hook
        ) = kernel.parties(jobId);
        AccrueJobs.Job memory job = kernel.getJob(jobId);
        assertEq(c, job.client);
        assertEq(p, job.provider);
        assertEq(e, job.evaluator);
        assertEq(uint8(status), uint8(job.status));
        assertEq(budget, job.budget);
        assertEq(expiredAt, job.expiredAt);
        assertEq(hook, job.hook);
    }

    function testFuzz_settlementConservesFunds(uint96 budget, uint8 outcome) public {
        budget = uint96(bound(budget, 1, 1_000e6));
        uint256 jobId = _plainJob();
        vm.startPrank(client);
        kernel.setBudget(jobId, budget, "");
        kernel.fund(jobId, budget, "");
        vm.stopPrank();
        uint256 total = usdc.balanceOf(client) + usdc.balanceOf(provider) + usdc.balanceOf(address(kernel));
        outcome = outcome % 3;
        if (outcome == 0) {
            vm.prank(provider);
            kernel.submit(jobId, DELIVERABLE, "");
            vm.prank(evaluator);
            kernel.complete(jobId, REASON, "");
            assertEq(usdc.balanceOf(provider), budget);
        } else if (outcome == 1) {
            vm.prank(evaluator);
            kernel.reject(jobId, REASON, "");
        } else {
            vm.warp(block.timestamp + 7 days);
            kernel.claimRefund(jobId);
        }
        assertEq(usdc.balanceOf(address(kernel)), 0);
        assertEq(usdc.balanceOf(client) + usdc.balanceOf(provider), total);
    }

    function _signPermit(uint256 value, uint256 deadline) internal view returns (uint8, bytes32, bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(usdc.PERMIT_TYPEHASH(), client, address(kernel), value, usdc.nonces(client), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(clientKey, digest);
    }
}
