// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IACPHook, IERC165} from "./interfaces/IACPHook.sol";
import {AccrueJobs} from "./AccrueJobs.sol";

/// @title AccruePanel
/// @notice The evaluator and policy hook for Accrue jobs on an ERC-8183 kernel.
/// Each job names a panel of one to five reviewers (Accrue's Proof Engine agent,
/// people, or both) and how many of them must agree that the work is done:
///   - a passing quorum pays the provider at once;
///   - as soon as a pass becomes impossible, the client is refunded;
///   - work delivered on time that the panel lets sit through its whole review
///     window is paid: silence is not a no, so a client cannot keep delivered
///     work by naming reviewers who never answer;
///   - a job nobody delivered on is refunded after its delivery deadline;
///   - client and provider together can call a funded job off.
/// Every delivery carries its evidence, and every vote its report, in this
/// contract's events, so a job can be audited from the chain alone.
/// @dev Bound to one kernel, which alone may call the hook functions. The panel
/// must be both a job's evaluator and its hook. Prototype code: not audited.
contract AccruePanel is IACPHook, IERC165 {
    AccrueJobs public immutable jobs;

    uint256 public constant MAX_REVIEWERS = 5;
    uint32 public constant MIN_REVIEW_WINDOW = 10 minutes;
    uint32 public constant MAX_REVIEW_WINDOW = 30 days;
    /// @notice Time between the latest possible end of review and the job's
    /// expiry, so a silent panel's job can be settled before anyone can refund it.
    uint32 public constant SETTLE_GRACE = 1 days;
    uint256 public constant MAX_EVIDENCE = 4096;
    uint256 public constant MAX_REPORT = 8192;
    uint256 public constant MAX_PITCH = 1024;
    uint256 public constant MAX_APPLICATIONS = 64;

    /// @notice `reason` on the kernel when a job is decided without a vote.
    bytes32 public constant SILENCE = keccak256("accrue.panel.silence");
    bytes32 public constant NO_DELIVERY = keccak256("accrue.panel.no-delivery");
    bytes32 public constant CANCELLED = keccak256("accrue.panel.cancelled");

    uint8 private constant NO_VOTE = 0;
    uint8 private constant PASS = 1;
    uint8 private constant FAIL = 2;

    struct Config {
        address[] reviewers;
        uint8 threshold;
        uint32 reviewWindow;
        uint64 deliverBy;
    }

    struct Vote {
        uint8 choice;
        uint64 blockNumber;
        bytes32 reportHash;
    }

    struct State {
        bool configured;
        uint8 passes;
        uint8 fails;
        /// bit 1: client consents to cancel; bit 2: provider does.
        uint8 cancelConsent;
        uint64 deliveredAt;
        uint64 deliveredBlock;
    }

    struct Application {
        address applicant;
        uint64 blockNumber;
    }

    mapping(uint256 => Config) private _configs;
    mapping(uint256 => State) private _states;
    mapping(uint256 => mapping(address => Vote)) private _votes;
    mapping(uint256 => Application[]) private _applications;
    mapping(uint256 => mapping(address => bool)) public hasApplied;

    event PanelSet(uint256 indexed jobId, address[] reviewers, uint8 threshold, uint32 reviewWindow, uint64 deliverBy);
    event Delivered(uint256 indexed jobId, address indexed provider, bytes32 indexed deliverable, string evidence);
    event Voted(uint256 indexed jobId, address indexed reviewer, bool pass, bytes32 reportHash, string report);
    event SettledOnSilence(uint256 indexed jobId);
    event RefundedUndelivered(uint256 indexed jobId);
    event CancelConsent(uint256 indexed jobId, address indexed party);
    event Applied(uint256 indexed jobId, address indexed applicant, string pitch);

    error Unauthorized();
    error NotGoverned();
    error PanelRequired();
    error InvalidPanel();
    error ProviderOnPanel();
    error WrongStatus();
    error DeliveryClosed();
    error DeliveryOpen();
    error BadEvidence();
    error NotReviewer();
    error AlreadyVoted();
    error ReviewClosed();
    error ReviewOpen();
    error BadReport();
    error NotParty();
    error AlreadyConsented();
    error CannotApply();

    modifier onlyJobs() {
        if (msg.sender != address(jobs)) revert Unauthorized();
        _;
    }

    constructor(AccrueJobs jobs_) {
        if (address(jobs_).code.length == 0) revert Unauthorized();
        jobs = jobs_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ───────────────────────────── Hook callbacks ─────────────────────────────

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external onlyJobs {
        if (selector == AccrueJobs.setBudget.selector) {
            (address caller,, bytes memory optParams) = abi.decode(data, (address, uint256, bytes));
            _onSetBudget(jobId, caller, optParams);
        } else if (selector == AccrueJobs.setProvider.selector) {
            (, address provider,) = abi.decode(data, (address, address, bytes));
            if (_states[jobId].configured && _isReviewer(_configs[jobId], provider)) revert ProviderOnPanel();
        } else if (selector == AccrueJobs.fund.selector) {
            _onFund(jobId);
        } else if (selector == AccrueJobs.submit.selector) {
            (address provider, bytes32 deliverable, bytes memory optParams) =
                abi.decode(data, (address, bytes32, bytes));
            _onSubmit(jobId, provider, deliverable, optParams);
        }
        // complete and reject reach the kernel only through this panel, or from a
        // client calling off a job that was never funded; neither needs a check.
    }

    function afterAction(uint256, bytes4 selector, bytes calldata data) external view onlyJobs {
        if (selector == AccrueJobs.createJob.selector) {
            (,, address evaluator) = abi.decode(data, (address, address, address));
            // Pay-on-silence and refunds need the panel to be able to decide the job.
            if (evaluator != address(this)) revert NotGoverned();
        }
    }

    // ───────────────────────────────── Review ─────────────────────────────────

    /// @notice Records a reviewer's verdict on the delivered work, with the
    /// report it rests on, and decides the job once the outcome is certain.
    function vote(uint256 jobId, bool pass, string calldata report) external {
        (,,, AccrueJobs.JobStatus status,,,) = _governed(jobId);
        if (status != AccrueJobs.JobStatus.Submitted) revert WrongStatus();
        Config storage config = _configs[jobId];
        if (!_isReviewer(config, msg.sender)) revert NotReviewer();
        State storage state = _states[jobId];
        if (block.timestamp >= uint256(state.deliveredAt) + config.reviewWindow) revert ReviewClosed();
        Vote storage ballot = _votes[jobId][msg.sender];
        if (ballot.choice != NO_VOTE) revert AlreadyVoted();
        uint256 length = bytes(report).length;
        if (length == 0 || length > MAX_REPORT) revert BadReport();

        bytes32 reportHash = keccak256(bytes(report));
        ballot.choice = pass ? PASS : FAIL;
        ballot.blockNumber = uint64(block.number);
        ballot.reportHash = reportHash;
        if (pass) state.passes++;
        else state.fails++;
        emit Voted(jobId, msg.sender, pass, reportHash, report);

        if (state.passes >= config.threshold) {
            jobs.complete(jobId, reportHash, "");
        } else if (state.fails > config.reviewers.length - config.threshold) {
            // Enough reviewers said no that a passing quorum can no longer form.
            jobs.reject(jobId, reportHash, "");
        }
    }

    /// @notice Pays a delivery whose review window ended without a decision.
    /// Anyone may call it.
    function settle(uint256 jobId) external {
        (,,, AccrueJobs.JobStatus status,,,) = _governed(jobId);
        if (status != AccrueJobs.JobStatus.Submitted) revert WrongStatus();
        if (block.timestamp < uint256(_states[jobId].deliveredAt) + _configs[jobId].reviewWindow) revert ReviewOpen();
        emit SettledOnSilence(jobId);
        jobs.complete(jobId, SILENCE, "");
    }

    /// @notice Refunds a funded job whose provider let the delivery deadline pass.
    /// Anyone may call it.
    function refundUndelivered(uint256 jobId) external {
        (,,, AccrueJobs.JobStatus status,,,) = _governed(jobId);
        if (status != AccrueJobs.JobStatus.Funded) revert WrongStatus();
        if (block.timestamp <= _configs[jobId].deliverBy) revert DeliveryOpen();
        emit RefundedUndelivered(jobId);
        jobs.reject(jobId, NO_DELIVERY, "");
    }

    /// @notice Consent to call off a funded job. Once client and provider have
    /// both consented, the budget goes back to the client.
    function cancel(uint256 jobId) external {
        (address client, address provider,, AccrueJobs.JobStatus status,,,) = _governed(jobId);
        if (status != AccrueJobs.JobStatus.Funded && status != AccrueJobs.JobStatus.Submitted) revert WrongStatus();
        uint8 bit;
        if (msg.sender == client) bit = 1;
        else if (msg.sender == provider) bit = 2;
        else revert NotParty();
        State storage state = _states[jobId];
        if (state.cancelConsent & bit != 0) revert AlreadyConsented();
        state.cancelConsent |= bit;
        emit CancelConsent(jobId, msg.sender);
        if (state.cancelConsent == 3) jobs.reject(jobId, CANCELLED, "");
    }

    /// @notice Offers to take on an open job that has no provider yet. The client
    /// picks from the applications and assigns one, which funds the job.
    function applyToJob(uint256 jobId, string calldata pitch) external {
        (address client, address provider,, AccrueJobs.JobStatus status,,,) = _governed(jobId);
        if (status != AccrueJobs.JobStatus.Open || provider != address(0)) revert CannotApply();
        if (msg.sender == client || hasApplied[jobId][msg.sender]) revert CannotApply();
        if (_states[jobId].configured && _isReviewer(_configs[jobId], msg.sender)) revert ProviderOnPanel();
        if (bytes(pitch).length > MAX_PITCH || _applications[jobId].length >= MAX_APPLICATIONS) revert CannotApply();
        hasApplied[jobId][msg.sender] = true;
        _applications[jobId].push(Application(msg.sender, uint64(block.number)));
        emit Applied(jobId, msg.sender, pitch);
    }

    // ───────────────────────────────── Views ─────────────────────────────────

    function getConfig(uint256 jobId) external view returns (Config memory) {
        return _configs[jobId];
    }

    function getState(uint256 jobId) external view returns (State memory) {
        return _states[jobId];
    }

    function getVote(uint256 jobId, address reviewer) external view returns (Vote memory) {
        return _votes[jobId][reviewer];
    }

    function getApplications(uint256 jobId) external view returns (Application[] memory) {
        return _applications[jobId];
    }

    /// @notice When silence starts to pay: zero until the work is delivered.
    function reviewEndsAt(uint256 jobId) external view returns (uint256) {
        uint64 deliveredAt = _states[jobId].deliveredAt;
        return deliveredAt == 0 ? 0 : uint256(deliveredAt) + _configs[jobId].reviewWindow;
    }

    /// @notice The panel config encoded as the `optParams` a client passes to
    /// the kernel's setBudget.
    function encodeConfig(address[] calldata reviewers, uint8 threshold, uint32 reviewWindow, uint64 deliverBy)
        external
        pure
        returns (bytes memory)
    {
        return abi.encode(reviewers, threshold, reviewWindow, deliverBy);
    }

    // ─────────────────────────────── Internals ───────────────────────────────

    function _onSetBudget(uint256 jobId, address caller, bytes memory optParams) private {
        (address client, address provider,,,, uint256 expiredAt,) = jobs.parties(jobId);
        // A provider may propose a price but never changes the panel.
        if (caller != client) {
            if (optParams.length != 0) revert Unauthorized();
            return;
        }
        if (optParams.length == 0) {
            if (!_states[jobId].configured) revert PanelRequired();
            return;
        }
        (address[] memory reviewers, uint8 threshold, uint32 reviewWindow, uint64 deliverBy) =
            abi.decode(optParams, (address[], uint8, uint32, uint64));

        uint256 count = reviewers.length;
        if (count == 0 || count > MAX_REVIEWERS || threshold == 0 || threshold > count) revert InvalidPanel();
        if (reviewWindow < MIN_REVIEW_WINDOW || reviewWindow > MAX_REVIEW_WINDOW) revert InvalidPanel();
        if (deliverBy <= block.timestamp) revert InvalidPanel();
        if (uint256(deliverBy) + reviewWindow + SETTLE_GRACE > expiredAt) revert InvalidPanel();
        for (uint256 i; i < count; ++i) {
            address reviewer = reviewers[i];
            if (reviewer == address(0) || reviewer == address(this)) revert InvalidPanel();
            if (reviewer == provider) revert ProviderOnPanel();
            for (uint256 j; j < i; ++j) {
                if (reviewer == reviewers[j]) revert InvalidPanel();
            }
        }

        Config storage config = _configs[jobId];
        config.reviewers = reviewers;
        config.threshold = threshold;
        config.reviewWindow = reviewWindow;
        config.deliverBy = deliverBy;
        _states[jobId].configured = true;
        emit PanelSet(jobId, reviewers, threshold, reviewWindow, deliverBy);
    }

    function _onFund(uint256 jobId) private view {
        if (!_states[jobId].configured) revert PanelRequired();
        Config storage config = _configs[jobId];
        // There must still be time to deliver.
        if (block.timestamp >= config.deliverBy) revert DeliveryClosed();
        (, address provider,,,,,) = jobs.parties(jobId);
        if (_isReviewer(config, provider)) revert ProviderOnPanel();
    }

    function _onSubmit(uint256 jobId, address provider, bytes32 deliverable, bytes memory optParams) private {
        if (block.timestamp > _configs[jobId].deliverBy) revert DeliveryClosed();
        if (optParams.length == 0) revert BadEvidence();
        string memory evidence = abi.decode(optParams, (string));
        uint256 length = bytes(evidence).length;
        if (length == 0 || length > MAX_EVIDENCE || keccak256(bytes(evidence)) != deliverable) revert BadEvidence();
        State storage state = _states[jobId];
        state.deliveredAt = uint64(block.timestamp);
        state.deliveredBlock = uint64(block.number);
        emit Delivered(jobId, provider, deliverable, evidence);
    }

    function _governed(uint256 jobId)
        private
        view
        returns (
            address client,
            address provider,
            address evaluator,
            AccrueJobs.JobStatus status,
            uint256 budget,
            uint256 expiredAt,
            address hook
        )
    {
        (client, provider, evaluator, status, budget, expiredAt, hook) = jobs.parties(jobId);
        if (evaluator != address(this) || hook != address(this)) revert NotGoverned();
    }

    function _isReviewer(Config storage config, address account) private view returns (bool) {
        address[] storage reviewers = config.reviewers;
        for (uint256 i; i < reviewers.length; ++i) {
            if (reviewers[i] == account) return true;
        }
        return false;
    }
}
