import {
  createPublicClient,
  decodeEventLog,
  http,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { chain, CONTRACTS, RPC_URL } from "./arc";
import { jobsAbi, panelAbi } from "./abi";
import { decodeBrief, decodeEvidence, type Brief, type Evidence } from "./policy";

/**
 * Reads Accrue jobs straight from Arc. Everything a page shows comes from the
 * two contracts: job state and timestamps from the kernel, the panel and votes
 * from AccruePanel, and evidence and reports from events fetched at the exact
 * block the contracts recorded, so no history scan or indexer is needed.
 */

export const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { wait: 16 }, retryCount: 4, retryDelay: 250, timeout: 20_000 }),
});

export const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const;
export type Status = (typeof STATUS)[number];

export const REASONS = {
  silence: keccak256(toHex("accrue.panel.silence")),
  noDelivery: keccak256(toHex("accrue.panel.no-delivery")),
  cancelled: keccak256(toHex("accrue.panel.cancelled")),
} as const;

export type Phase =
  | "hiring" // open, no provider yet
  | "awaiting_funds" // provider named, not funded
  | "in_progress" // funded, waiting for delivery
  | "overdue" // delivery deadline passed with nothing delivered
  | "in_review" // delivered, review window open
  | "review_lapsed" // delivered, window over without a decision: silence pays
  | "paid"
  | "paid_on_silence"
  | "refunded" // a panel quorum said no
  | "refunded_undelivered"
  | "cancelled"
  | "withdrawn" // the client called off an unfunded job
  | "expired";

export type VoteView = {
  reviewer: Address;
  choice: "none" | "pass" | "fail";
  blockNumber: number;
  reportHash: Hex;
  report?: string;
  tx?: Hex;
};

export type JobView = {
  id: number;
  client: Address;
  provider: Address | null;
  evaluator: Address;
  hook: Address;
  description: string;
  brief: Brief | null;
  budget: string; // USDC base units, as a decimal string so it survives JSON
  expiredAt: number;
  status: Status;
  phase: Phase;
  governed: boolean;
  timeline: {
    createdAt: number;
    createdBlock: number;
    fundedAt: number;
    fundedBlock: number;
    submittedAt: number;
    submittedBlock: number;
    closedAt: number;
    closedBlock: number;
    deliverable: Hex;
    reason: Hex;
  };
  panel: {
    reviewers: Address[];
    threshold: number;
    reviewWindow: number;
    deliverBy: number;
    passes: number;
    fails: number;
    cancelConsent: number;
    deliveredAt: number;
    deliveredBlock: number;
    reviewEndsAt: number;
    votes: VoteView[];
  } | null;
};

export type JobDetail = JobView & {
  evidence: { json: string; parsed: Evidence | null; tx?: Hex } | null;
  applications: { applicant: Address; blockNumber: number; pitch: string }[];
  txs: Partial<Record<"created" | "funded" | "submitted" | "closed", Hex>>;
};

type RawJob = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
};

type RawTimeline = {
  createdAt: bigint;
  createdBlock: bigint;
  fundedAt: bigint;
  fundedBlock: bigint;
  submittedAt: bigint;
  submittedBlock: bigint;
  closedAt: bigint;
  closedBlock: bigint;
  deliverable: Hex;
  reason: Hex;
};

type RawConfig = { reviewers: readonly Address[]; threshold: number; reviewWindow: number; deliverBy: bigint };
type RawState = {
  configured: boolean;
  passes: number;
  fails: number;
  cancelConsent: number;
  deliveredAt: bigint;
  deliveredBlock: bigint;
};

export async function jobCount(): Promise<number> {
  const count = await publicClient.readContract({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "jobCounter" });
  return Number(count);
}

export async function contractsDeployed(): Promise<boolean> {
  const [jobsCode, panelCode] = await Promise.all([
    publicClient.getCode({ address: CONTRACTS.jobs }),
    publicClient.getCode({ address: CONTRACTS.panel }),
  ]);
  return !!jobsCode && jobsCode !== "0x" && !!panelCode && panelCode !== "0x";
}

/** Reads jobs by id in two multicall rounds: jobs and panels, then votes. */
export async function readJobs(ids: number[], now = Math.floor(Date.now() / 1000)): Promise<JobView[]> {
  if (ids.length === 0) return [];
  const first = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.flatMap((id) => [
      { address: CONTRACTS.jobs, abi: jobsAbi, functionName: "getJob", args: [BigInt(id)] } as const,
      { address: CONTRACTS.jobs, abi: jobsAbi, functionName: "getTimeline", args: [BigInt(id)] } as const,
      { address: CONTRACTS.panel, abi: panelAbi, functionName: "getConfig", args: [BigInt(id)] } as const,
      { address: CONTRACTS.panel, abi: panelAbi, functionName: "getState", args: [BigInt(id)] } as const,
    ]),
  });

  const partial = ids.map((id, i) => ({
    id,
    job: first[i * 4] as unknown as RawJob,
    timeline: first[i * 4 + 1] as unknown as RawTimeline,
    config: first[i * 4 + 2] as unknown as RawConfig,
    state: first[i * 4 + 3] as unknown as RawState,
  }));

  const voteCalls = partial.flatMap(({ id, config }) =>
    config.reviewers.map(
      (reviewer) =>
        ({
          address: CONTRACTS.panel,
          abi: panelAbi,
          functionName: "getVote",
          args: [BigInt(id), reviewer],
        }) as const,
    ),
  );
  const voteResults = voteCalls.length
    ? await publicClient.multicall({ allowFailure: false, contracts: voteCalls })
    : [];

  let cursor = 0;
  return partial.map(({ id, job, timeline, config, state }) => {
    const votes: VoteView[] = config.reviewers.map((reviewer) => {
      const raw = voteResults[cursor++] as unknown as { choice: number; blockNumber: bigint; reportHash: Hex };
      return {
        reviewer,
        choice: raw.choice === 1 ? "pass" : raw.choice === 2 ? "fail" : "none",
        blockNumber: Number(raw.blockNumber),
        reportHash: raw.reportHash,
      };
    });
    return toView(id, job, timeline, config, state, votes, now);
  });
}

function toView(
  id: number,
  job: RawJob,
  t: RawTimeline,
  config: RawConfig,
  state: RawState,
  votes: VoteView[],
  now: number,
): JobView {
  const status = STATUS[job.status] ?? "Open";
  const governed =
    job.evaluator.toLowerCase() === CONTRACTS.panel.toLowerCase() &&
    job.hook.toLowerCase() === CONTRACTS.panel.toLowerCase();
  const panel = state.configured
    ? {
        reviewers: [...config.reviewers],
        threshold: config.threshold,
        reviewWindow: config.reviewWindow,
        deliverBy: Number(config.deliverBy),
        passes: state.passes,
        fails: state.fails,
        cancelConsent: state.cancelConsent,
        deliveredAt: Number(state.deliveredAt),
        deliveredBlock: Number(state.deliveredBlock),
        reviewEndsAt: state.deliveredAt > 0n ? Number(state.deliveredAt) + config.reviewWindow : 0,
        votes,
      }
    : null;
  const view: JobView = {
    id,
    client: job.client,
    provider: job.provider === zeroAddress ? null : job.provider,
    evaluator: job.evaluator,
    hook: job.hook,
    description: job.description,
    brief: decodeBrief(job.description),
    budget: job.budget.toString(),
    expiredAt: Number(job.expiredAt),
    status,
    phase: "hiring",
    governed,
    timeline: {
      createdAt: Number(t.createdAt),
      createdBlock: Number(t.createdBlock),
      fundedAt: Number(t.fundedAt),
      fundedBlock: Number(t.fundedBlock),
      submittedAt: Number(t.submittedAt),
      submittedBlock: Number(t.submittedBlock),
      closedAt: Number(t.closedAt),
      closedBlock: Number(t.closedBlock),
      deliverable: t.deliverable,
      reason: t.reason,
    },
    panel,
  };
  view.phase = phaseOf(view, now);
  return view;
}

export function phaseOf(job: JobView, now: number): Phase {
  switch (job.status) {
    case "Open":
      return job.provider ? "awaiting_funds" : "hiring";
    case "Funded":
      return job.panel && now > job.panel.deliverBy ? "overdue" : "in_progress";
    case "Submitted":
      return job.panel && job.panel.reviewEndsAt > 0 && now >= job.panel.reviewEndsAt ? "review_lapsed" : "in_review";
    case "Completed":
      return job.timeline.reason === REASONS.silence ? "paid_on_silence" : "paid";
    case "Rejected":
      if (job.timeline.reason === REASONS.cancelled) return "cancelled";
      if (job.timeline.reason === REASONS.noDelivery) return "refunded_undelivered";
      return job.timeline.fundedAt === 0 ? "withdrawn" : "refunded";
    case "Expired":
      return "expired";
  }
}

export const PHASE_LABEL: Record<Phase, string> = {
  hiring: "Hiring",
  awaiting_funds: "Awaiting funds",
  in_progress: "In progress",
  overdue: "Overdue",
  in_review: "In review",
  review_lapsed: "Review lapsed",
  paid: "Paid",
  paid_on_silence: "Paid on silence",
  refunded: "Refunded",
  refunded_undelivered: "Refunded",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export function isSettled(phase: Phase): boolean {
  return [
    "paid",
    "paid_on_silence",
    "refunded",
    "refunded_undelivered",
    "cancelled",
    "withdrawn",
    "expired",
  ].includes(phase);
}

/** The newest `limit` jobs, newest first. */
export async function readRecentJobs(limit = 50): Promise<{ total: number; jobs: JobView[] }> {
  const total = await jobCount();
  const ids: number[] = [];
  for (let id = total; id >= 1 && ids.length < limit; id--) ids.push(id);
  const jobs = await readJobs(ids);
  return { total, jobs };
}

// ─── Events at known blocks ───

async function logsAt(address: Address, block: number): Promise<Log[]> {
  if (!block) return [];
  for (let attempt = 0; ; attempt++) {
    try {
      return await publicClient.getLogs({ address, fromBlock: BigInt(block), toBlock: BigInt(block) });
    } catch (error) {
      // Arc's public endpoint is load-balanced; a backend a block behind
      // answers -32014 for a head block. A short wait fixes it.
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

type Decoded = { eventName: string; args: Record<string, unknown>; tx: Hex };

function decode(logs: Log[], abi: typeof jobsAbi | typeof panelAbi, jobId: number): Decoded[] {
  const out: Decoded[] = [];
  for (const log of logs) {
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics }) as unknown as {
        eventName: string;
        args: Record<string, unknown>;
      };
      if (event.args && "jobId" in event.args && Number(event.args.jobId as bigint) === jobId) {
        out.push({ eventName: event.eventName, args: event.args, tx: log.transactionHash as Hex });
      }
    } catch {
      // A log from another contract or event: not ours.
    }
  }
  return out;
}

/** A job with its evidence, reports, applications and the tx of each step. */
export async function readJobDetail(id: number): Promise<JobDetail | null> {
  const count = await jobCount();
  if (id < 1 || id > count) return null;
  const [job] = await readJobs([id]);

  const kernelBlocks = new Set(
    [job.timeline.createdBlock, job.timeline.fundedBlock, job.timeline.submittedBlock, job.timeline.closedBlock].filter(
      Boolean,
    ),
  );
  const panelBlocks = new Set<number>();
  if (job.panel?.deliveredBlock) panelBlocks.add(job.panel.deliveredBlock);
  for (const v of job.panel?.votes ?? []) if (v.blockNumber) panelBlocks.add(v.blockNumber);

  let applicationsRaw: { applicant: Address; blockNumber: bigint }[] = [];
  if (job.status === "Open" && job.governed) {
    applicationsRaw = [
      ...((await publicClient.readContract({
        address: CONTRACTS.panel,
        abi: panelAbi,
        functionName: "getApplications",
        args: [BigInt(id)],
      })) as readonly { applicant: Address; blockNumber: bigint }[]),
    ];
    for (const a of applicationsRaw) panelBlocks.add(Number(a.blockNumber));
  }

  const [kernelLogs, panelLogs] = await Promise.all([
    Promise.all([...kernelBlocks].map((b) => logsAt(CONTRACTS.jobs, b))),
    Promise.all([...panelBlocks].map((b) => logsAt(CONTRACTS.panel, b))),
  ]);
  const kernelEvents = decode(kernelLogs.flat(), jobsAbi, id);
  const panelEvents = decode(panelLogs.flat(), panelAbi, id);

  const txs: JobDetail["txs"] = {};
  for (const e of kernelEvents) {
    if (e.eventName === "JobCreated") txs.created = e.tx;
    if (e.eventName === "JobFunded") txs.funded = e.tx;
    if (e.eventName === "JobSubmitted") txs.submitted = e.tx;
    if (["JobCompleted", "JobRejected", "JobExpired"].includes(e.eventName)) txs.closed = e.tx;
  }

  let evidence: JobDetail["evidence"] = null;
  const delivered = panelEvents.find((e) => e.eventName === "Delivered");
  if (delivered) {
    const json = String(delivered.args.evidence ?? "");
    evidence = { json, parsed: decodeEvidence(json), tx: delivered.tx };
  }

  if (job.panel) {
    for (const vote of job.panel.votes) {
      const event = panelEvents.find(
        (e) =>
          e.eventName === "Voted" && String(e.args.reviewer).toLowerCase() === vote.reviewer.toLowerCase(),
      );
      if (event) {
        vote.report = String(event.args.report ?? "");
        vote.tx = event.tx;
      }
    }
  }

  const applications = applicationsRaw.map((a) => {
    const event = panelEvents.find(
      (e) => e.eventName === "Applied" && String(e.args.applicant).toLowerCase() === a.applicant.toLowerCase(),
    );
    return { applicant: a.applicant, blockNumber: Number(a.blockNumber), pitch: String(event?.args.pitch ?? "") };
  });

  return { ...job, evidence, applications, txs };
}

/** USDC paid out and refunded across jobs, for the landing page. */
export function totals(jobs: JobView[]): { paid: bigint; escrowed: bigint; refunded: bigint; settledCount: number } {
  let paid = 0n;
  let escrowed = 0n;
  let refunded = 0n;
  let settledCount = 0;
  for (const job of jobs) {
    const budget = BigInt(job.budget);
    if (job.status === "Completed") {
      paid += budget;
      settledCount++;
    } else if (job.status === "Funded" || job.status === "Submitted") escrowed += budget;
    else if ((job.status === "Rejected" && job.timeline.fundedAt > 0) || job.status === "Expired") {
      refunded += budget;
      settledCount++;
    }
  }
  return { paid, escrowed, refunded, settledCount };
}
