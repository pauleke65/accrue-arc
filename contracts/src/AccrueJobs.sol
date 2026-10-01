// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IACPHook, IERC165} from "./interfaces/IACPHook.sol";

interface IUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @title AccrueJobs
/// @notice An ERC-8183 (Agentic Commerce) job escrow settled in USDC on Arc.
/// A client opens a job with a brief, an evaluator and an expiry; the budget is
/// escrowed when the client funds it; the provider submits a deliverable; and the
/// evaluator alone decides it: complete pays the provider, reject refunds the
/// client. After expiry anyone can return an undecided job's budget to the client.
/// @dev Non-upgradeable and ownerless: there is no admin, fee switch, pause or hook
/// allowlist, so nobody can move escrowed USDC except by the rules below. The
/// payment token is fixed at deployment (on Arc, USDC's ERC-20 interface at
/// 0x3600…0000, 6 decimals). Hooks are chosen per job by its client, are called
/// with a gas cap, and can never block `claimRefund`. Hook `data` is encoded as in
/// the ERC-8183 reference implementation, with the caller first.
/// Prototype code: not independently audited.
contract AccrueJobs {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    /// @notice When each step happened, by time and block, so a reader can fetch
    /// a job's events from the exact block instead of scanning chain history.
    struct Timeline {
        uint64 createdAt;
        uint64 createdBlock;
        uint64 fundedAt;
        uint64 fundedBlock;
        uint64 submittedAt;
        uint64 submittedBlock;
        uint64 closedAt;
        uint64 closedBlock;
        bytes32 deliverable;
        bytes32 reason;
    }

    /// @notice Arguments for opening a job and setting its budget in one call.
    struct NewJob {
        address provider;
        address evaluator;
        uint256 expiredAt;
        string description;
        address hook;
        uint256 budget;
        bytes budgetParams;
        bytes fundParams;
    }

    IUSDC public immutable paymentToken;

    /// @notice Hooks get at most this much gas per call.
    uint256 public constant HOOK_GAS_LIMIT = 1_000_000;
    /// @notice A job must stay open at least this long.
    uint256 public constant MIN_EXPIRY = 5 minutes;
    /// @notice Briefs are stored on chain; this bounds what readers must load.
    uint256 public constant MAX_DESCRIPTION = 4096;

    uint256 public jobCounter;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => Timeline) private _timeline;
    bool private transient _locked;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ZeroAddress();
    error ExpiryTooShort();
    error DescriptionTooLong();
    error ZeroBudget();
    error ProviderNotSet();
    error BudgetMismatch();
    error JobExpiredAlready();
    error EmptyDeliverable();
    error HookNotSupported();
    error TransferFailed();
    error UnsupportedToken();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    constructor(address token) {
        if (token.code.length == 0) revert ZeroAddress();
        paymentToken = IUSDC(token);
    }

    // ───────────────────────────── ERC-8183 core ─────────────────────────────

    /// @notice Opens a job. The caller is its client. `provider` may be zero and
    /// set later; `evaluator` alone decides the job once work is submitted.
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external nonReentrant returns (uint256 jobId) {
        jobId = _create(msg.sender, provider, evaluator, expiredAt, description, hook);
    }

    /// @notice Names the provider of a job opened without one. Client only.
    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        _setProvider(job, jobId, msg.sender, provider, optParams);
    }

    /// @notice Sets the price. Client or provider; the client confirms it by funding.
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client && msg.sender != job.provider) revert Unauthorized();
        _setBudget(job, jobId, msg.sender, amount, optParams);
    }

    /// @notice Escrows the budget. `expectedBudget` must equal it, so a price
    /// change slipped in before this transaction cannot charge the client more.
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        _fund(job, jobId, msg.sender, expectedBudget, optParams);
    }

    /// @notice Hands in the work. Provider only, while funded and before expiry.
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Funded) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert JobExpiredAlready();
        if (deliverable == bytes32(0)) revert EmptyDeliverable();

        bytes memory data = abi.encode(msg.sender, deliverable, optParams);
        _before(job.hook, jobId, this.submit.selector, data);

        job.status = JobStatus.Submitted;
        Timeline storage t = _timeline[jobId];
        t.submittedAt = uint64(block.timestamp);
        t.submittedBlock = uint64(block.number);
        t.deliverable = deliverable;
        emit JobSubmitted(jobId, msg.sender, deliverable);

        _after(job.hook, jobId, this.submit.selector, data);
    }

    /// @notice Accepts submitted work and pays the provider. Evaluator only.
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _before(job.hook, jobId, this.complete.selector, data);

        job.status = JobStatus.Completed;
        _close(jobId, reason);
        uint256 amount = job.budget;
        _push(job.provider, amount);
        emit JobCompleted(jobId, msg.sender, reason);
        emit PaymentReleased(jobId, job.provider, amount);

        _after(job.hook, jobId, this.complete.selector, data);
    }

    /// @notice Calls a job off. The client may while it is Open; once funded only
    /// the evaluator may, and the escrowed budget goes back to the client.
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _job(jobId);
        JobStatus previous = job.status;
        if (previous == JobStatus.Open) {
            if (msg.sender != job.client) revert Unauthorized();
        } else if (previous == JobStatus.Funded || previous == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _before(job.hook, jobId, this.reject.selector, data);

        job.status = JobStatus.Rejected;
        _close(jobId, reason);
        if (previous != JobStatus.Open) {
            _push(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }
        emit JobRejected(jobId, msg.sender, reason);

        _after(job.hook, jobId, this.reject.selector, data);
    }

    /// @notice Returns an undecided job's budget to its client once it has expired.
    /// Anyone may call it, and no hook can block it.
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) revert WrongStatus();
        if (block.timestamp < job.expiredAt) revert WrongStatus();

        job.status = JobStatus.Expired;
        _close(jobId, bytes32(0));
        _push(job.client, job.budget);
        emit Refunded(jobId, job.client, job.budget);
        emit JobExpired(jobId);
    }

    // ───────────────────── Extensions (same rules, fewer steps) ─────────────────────

    /// @notice createJob, setBudget and fund in one transaction, for a job whose
    /// provider is already known. Hooks see the same three calls in order.
    function createAndFund(NewJob calldata p) external nonReentrant returns (uint256 jobId) {
        jobId = _createAndFund(p);
    }

    /// @notice As createAndFund, approving the budget with an EIP-2612 signature
    /// instead of a separate approve transaction.
    function createAndFundWithPermit(NewJob calldata p, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        _permit(p.budget, deadline, v, r, s);
        jobId = _createAndFund(p);
    }

    /// @notice createJob and setBudget in one transaction, for a job that will
    /// pick its provider later. Nothing is escrowed until it is assigned.
    function createWithBudget(NewJob calldata p) external nonReentrant returns (uint256 jobId) {
        jobId = _create(msg.sender, p.provider, p.evaluator, p.expiredAt, p.description, p.hook);
        _setBudget(_jobs[jobId], jobId, msg.sender, p.budget, p.budgetParams);
    }

    /// @notice setProvider and fund in one transaction. Client only.
    function assignAndFund(
        uint256 jobId,
        address provider,
        uint256 expectedBudget,
        bytes calldata providerParams,
        bytes calldata fundParams
    ) external nonReentrant {
        Job storage job = _job(jobId);
        _setProvider(job, jobId, msg.sender, provider, providerParams);
        _fund(job, jobId, msg.sender, expectedBudget, fundParams);
    }

    /// @notice As assignAndFund, approving the budget with an EIP-2612 signature.
    function assignAndFundWithPermit(
        uint256 jobId,
        address provider,
        uint256 expectedBudget,
        bytes calldata providerParams,
        bytes calldata fundParams,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        Job storage job = _job(jobId);
        _permit(expectedBudget, deadline, v, r, s);
        _setProvider(job, jobId, msg.sender, provider, providerParams);
        _fund(job, jobId, msg.sender, expectedBudget, fundParams);
    }

    // ───────────────────────────────── Views ─────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function getTimeline(uint256 jobId) external view returns (Timeline memory) {
        return _timeline[jobId];
    }

    /// @notice A job without its description, for hooks and evaluators that only
    /// need who is involved and where it stands.
    function parties(uint256 jobId)
        external
        view
        returns (
            address client,
            address provider,
            address evaluator,
            JobStatus status,
            uint256 budget,
            uint256 expiredAt,
            address hook
        )
    {
        Job storage job = _jobs[jobId];
        return (job.client, job.provider, job.evaluator, job.status, job.budget, job.expiredAt, job.hook);
    }

    // ─────────────────────────────── Internals ───────────────────────────────

    function _create(
        address client,
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) private returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroAddress();
        // A provider cannot be their own client or judge their own work.
        if (provider != address(0) && (provider == client || provider == evaluator)) revert Unauthorized();
        if (expiredAt <= block.timestamp + MIN_EXPIRY) revert ExpiryTooShort();
        if (bytes(description).length > MAX_DESCRIPTION) revert DescriptionTooLong();
        if (hook != address(0) && !_isHook(hook)) revert HookNotSupported();

        jobId = ++jobCounter;
        Job storage job = _jobs[jobId];
        job.id = jobId;
        job.client = client;
        job.provider = provider;
        job.evaluator = evaluator;
        job.description = description;
        job.expiredAt = expiredAt;
        job.hook = hook;
        Timeline storage t = _timeline[jobId];
        t.createdAt = uint64(block.timestamp);
        t.createdBlock = uint64(block.number);
        emit JobCreated(jobId, client, provider, evaluator, expiredAt, hook);

        _after(hook, jobId, this.createJob.selector, abi.encode(client, provider, evaluator));
    }

    function _setProvider(Job storage job, uint256 jobId, address caller, address provider, bytes calldata optParams)
        private
    {
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (caller != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider == address(0)) revert ZeroAddress();
        if (provider == job.client || provider == job.evaluator) revert Unauthorized();

        bytes memory data = abi.encode(caller, provider, optParams);
        _before(job.hook, jobId, this.setProvider.selector, data);
        job.provider = provider;
        emit ProviderSet(jobId, provider);
        _after(job.hook, jobId, this.setProvider.selector, data);
    }

    function _setBudget(Job storage job, uint256 jobId, address caller, uint256 amount, bytes calldata optParams)
        private
    {
        bytes memory data = abi.encode(caller, amount, optParams);
        _before(job.hook, jobId, this.setBudget.selector, data);
        job.budget = amount;
        emit BudgetSet(jobId, amount);
        _after(job.hook, jobId, this.setBudget.selector, data);
    }

    function _fund(Job storage job, uint256 jobId, address caller, uint256 expectedBudget, bytes calldata optParams)
        private
    {
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (caller != job.client) revert Unauthorized();
        if (job.budget == 0) revert ZeroBudget();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (job.budget != expectedBudget) revert BudgetMismatch();
        if (block.timestamp >= job.expiredAt) revert JobExpiredAlready();

        bytes memory data = abi.encode(caller, optParams);
        _before(job.hook, jobId, this.fund.selector, data);

        job.status = JobStatus.Funded;
        Timeline storage t = _timeline[jobId];
        t.fundedAt = uint64(block.timestamp);
        t.fundedBlock = uint64(block.number);
        _pull(job.client, job.budget);
        emit JobFunded(jobId, job.client, job.budget);

        _after(job.hook, jobId, this.fund.selector, data);
    }

    function _createAndFund(NewJob calldata p) private returns (uint256 jobId) {
        if (p.provider == address(0)) revert ProviderNotSet();
        jobId = _create(msg.sender, p.provider, p.evaluator, p.expiredAt, p.description, p.hook);
        Job storage job = _jobs[jobId];
        _setBudget(job, jobId, msg.sender, p.budget, p.budgetParams);
        _fund(job, jobId, msg.sender, p.budget, p.fundParams);
    }

    function _close(uint256 jobId, bytes32 reason) private {
        Timeline storage t = _timeline[jobId];
        t.closedAt = uint64(block.timestamp);
        t.closedBlock = uint64(block.number);
        t.reason = reason;
    }

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
    }

    function _isHook(address hook) private view returns (bool) {
        if (hook.code.length == 0) return false;
        try IERC165(hook).supportsInterface{gas: 30_000}(type(IACPHook).interfaceId) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _before(address hook, uint256 jobId, bytes4 selector, bytes memory data) private {
        if (hook != address(0)) IACPHook(hook).beforeAction{gas: HOOK_GAS_LIMIT}(jobId, selector, data);
    }

    function _after(address hook, uint256 jobId, bytes4 selector, bytes memory data) private {
        if (hook != address(0)) IACPHook(hook).afterAction{gas: HOOK_GAS_LIMIT}(jobId, selector, data);
    }

    /// @dev A permit that fails (already used, or front-run with the same
    /// signature) is ignored: the transfer below then needs an allowance anyway.
    function _permit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try paymentToken.permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
    }

    function _pull(address from, uint256 amount) private {
        uint256 beforeBalance = paymentToken.balanceOf(address(this));
        _call(abi.encodeCall(IUSDC.transferFrom, (from, address(this), amount)));
        if (paymentToken.balanceOf(address(this)) != beforeBalance + amount) revert UnsupportedToken();
    }

    function _push(address to, uint256 amount) private {
        _call(abi.encodeCall(IUSDC.transfer, (to, amount)));
    }

    function _call(bytes memory callData) private {
        (bool ok, bytes memory result) = address(paymentToken).call(callData);
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
    }
}
