import type { Hex } from "viem";
import { CONTRACTS, chain } from "../arc";
import { jobsAbi, panelAbi } from "../abi";
import { isSettled, jobCount, readJobDetail, readJobs, type JobDetail } from "../jobs";
import { decodeEvidence, type Brief } from "../policy";
import { aiConfigured, assess, type Assessment } from "./ai";
import { setupState } from "./bootstrap";
import { runChecks, type CheckReport } from "./checks";
import { write, type Sent } from "./tx";
import { account, seedStatus } from "./wallets";

/**
 * The Proof Engine, as an agent with its own wallet (and an ERC-8004 identity
 * on Arc). For every job that names it as a reviewer it checks the delivered
 * evidence and votes, publishing its report in the vote. It also keeps every
 * Accrue job moving, since those calls are open to anyone: it settles work a
 * silent panel let lapse, refunds jobs nobody delivered, and returns expired
 * budgets.
 */

export type Verdict = "pass" | "fail" | "abstain";

export type Evaluation = {
  verdict: Verdict;
  reason: string;
  report: string; // the exact JSON published on chain
  checks: CheckReport | null;
  ai: Assessment | null;
  retry: boolean;
};

const PASS_AT = 0.9;
const FAIL_AT = 0.1;
const REVIEW_AT = 0.2;
const MAX_AI_ATTEMPTS = 3;

type EngineState = {
  active: Set<number>;
  seen: number;
  attempts: Map<number, number>;
  retryAt: Map<number, number>;
  abstained: Set<number>;
  running: boolean;
  lastTick: number | null;
  lastError: string | null;
  votes: { jobId: number; verdict: Verdict; tx: Hex; at: number }[];
};
const g = globalThis as unknown as { __accrueEngine?: EngineState };
export const engineState: EngineState = (g.__accrueEngine ??= {
  active: new Set(),
  seen: 0,
  attempts: new Map(),
  retryAt: new Map(),
  abstained: new Set(),
  running: false,
  lastTick: null,
  lastError: null,
  votes: [],
});

function engineAddress(): `0x${string}` | null {
  return seedStatus() === "ok" ? account("engine").address : null;
}

/** The verdict rules, separated from I/O so they can be tested directly. */
export function decide(
  brief: Brief,
  checks: CheckReport,
  ai: Assessment | null,
  soleReviewer: boolean,
  attempts: number,
): { verdict: Verdict; reason: string; retry: boolean } {
  if (brief.check.kind === "manual") {
    return { verdict: "abstain", reason: "This job is judged by people; there is nothing for the engine to check.", retry: false };
  }
  const failed = checks.items.find((item) => !item.passed);
  if (checks.error) return { verdict: "abstain", reason: checks.error, retry: true };
  if (failed) return { verdict: "fail", reason: `${failed.label}: ${failed.detail}`, retry: false };
  if (!aiConfigured()) return { verdict: "pass", reason: "Every check in the job's definition of done passed.", retry: false };
  if (!ai) {
    if (attempts < MAX_AI_ATTEMPTS) return { verdict: "abstain", reason: "The model was unavailable; retrying.", retry: true };
    return { verdict: "pass", reason: "Every check passed; the model stayed unavailable, so the checks decide.", retry: false };
  }
  if (ai.requirementsMet <= FAIL_AT) return { verdict: "fail", reason: ai.reason, retry: false };
  if (ai.requirementsMet >= PASS_AT && ai.needsHumanReview <= REVIEW_AT)
    return { verdict: "pass", reason: ai.reason, retry: false };
  // Alone on the panel, checks that passed carry the job unless the model is
  // sure the brief was missed. With people on the panel, doubt goes to them.
  if (soleReviewer) return { verdict: "pass", reason: `Every check passed. ${ai.reason}`, retry: false };
  return { verdict: "abstain", reason: `Leaving this to the human reviewers: ${ai.reason}`, retry: false };
}

/** Checks a delivered job and builds the report. Does not vote. */
export async function evaluate(job: JobDetail): Promise<Evaluation> {
  const attempts = (engineState.attempts.get(job.id) ?? 0) + 1;
  engineState.attempts.set(job.id, attempts);
  const brief = job.brief;
  const evidence = job.evidence?.parsed ?? (job.evidence ? decodeEvidence(job.evidence.json) : null);
  let verdict: Verdict;
  let reason: string;
  let retry = false;
  let checks: CheckReport | null = null;
  let ai: Assessment | null = null;

  if (!brief) {
    verdict = "abstain";
    reason = "The job's description is not an Accrue brief, so there is nothing to check against.";
  } else if (!evidence) {
    verdict = "fail";
    reason = "No readable evidence was delivered with the submission.";
  } else {
    checks = await runChecks(brief.check, evidence, job.timeline.createdAt);
    const allPassed = !checks.error && checks.items.length > 0 && checks.items.every((item) => item.passed);
    if (allPassed && brief.check.kind !== "manual") ai = await assess(brief, evidence, checks);
    const sole = (job.panel?.reviewers.length ?? 0) === 1;
    ({ verdict, reason, retry } = decide(brief, checks, ai, sole, attempts));
  }

  const report = JSON.stringify({
    v: 1,
    engine: "Accrue Proof Engine",
    agent: setupState.agentId ? `erc8004:${chain.id}:${setupState.agentId}` : null,
    job: job.id,
    deliverable: job.timeline.deliverable,
    check: brief?.check.kind ?? null,
    url: evidence?.url ?? null,
    items: checks?.items ?? [],
    ai: ai ? { model: ai.model, requirementsMet: ai.requirementsMet, needsHumanReview: ai.needsHumanReview } : null,
    verdict,
    reason: reason.slice(0, 600),
    at: Math.floor(Date.now() / 1000),
  });
  return { verdict, reason, report, checks, ai, retry };
}

/** Evaluates and, unless abstaining, votes. Returns the vote transaction. */
export async function evaluateAndVote(jobId: number): Promise<{ evaluation: Evaluation; sent: Sent | null }> {
  const job = await readJobDetail(jobId);
  if (!job) throw new Error(`Job ${jobId} does not exist`);
  const evaluation = await evaluate(job);
  if (evaluation.verdict === "abstain") {
    if (evaluation.retry) engineState.retryAt.set(jobId, Date.now() + 60_000);
    else engineState.abstained.add(jobId);
    return { evaluation, sent: null };
  }
  const sent = await write("engine", {
    address: CONTRACTS.panel,
    abi: panelAbi,
    functionName: "vote",
    args: [BigInt(jobId), evaluation.verdict === "pass", evaluation.report],
  });
  engineState.votes.unshift({ jobId, verdict: evaluation.verdict, tx: sent.hash, at: Math.floor(Date.now() / 1000) });
  engineState.votes.length = Math.min(engineState.votes.length, 50);
  console.log(`[engine] job ${jobId}: ${evaluation.verdict} ${sent.hash}`);
  return { evaluation, sent };
}

async function keep(jobId: number, functionName: "settle" | "refundUndelivered" | "claimRefund") {
  const target =
    functionName === "claimRefund"
      ? { address: CONTRACTS.jobs, abi: jobsAbi }
      : { address: CONTRACTS.panel, abi: panelAbi };
  const sent = await write("engine", { ...target, functionName, args: [BigInt(jobId)] });
  console.log(`[engine] job ${jobId}: ${functionName} ${sent.hash}`);
}

/** One pass over every job that might need the engine. */
export async function engineTick(): Promise<void> {
  if (engineState.running || seedStatus() !== "ok") return;
  if (!(setupState.deployed.jobs && setupState.deployed.panel)) return;
  engineState.running = true;
  try {
    const me = engineAddress()!.toLowerCase();
    const total = await jobCount();
    for (let id = engineState.seen + 1; id <= total; id++) engineState.active.add(id);
    engineState.seen = total;
    const ids = [...engineState.active];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < ids.length; i += 50) {
      const jobs = await readJobs(ids.slice(i, i + 50), now);
      for (const job of jobs) {
        if (isSettled(job.phase)) {
          engineState.active.delete(job.id);
          continue;
        }
        if (!job.governed || !job.panel) continue;
        try {
          if (job.phase === "in_review") {
            const mine = job.panel.votes.find((v) => v.reviewer.toLowerCase() === me);
            const due = (engineState.retryAt.get(job.id) ?? 0) <= Date.now();
            if (mine && mine.choice === "none" && due && !engineState.abstained.has(job.id)) {
              await evaluateAndVote(job.id);
            }
          } else if (job.phase === "review_lapsed") {
            await keep(job.id, "settle");
          } else if (job.phase === "overdue") {
            await keep(job.id, "refundUndelivered");
          }
          if ((job.status === "Funded" || job.status === "Submitted") && now >= job.expiredAt) {
            await keep(job.id, "claimRefund");
          }
        } catch (error) {
          engineState.lastError = `job ${job.id}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`;
          console.error("[engine]", engineState.lastError);
        }
      }
    }
    engineState.lastTick = now;
  } catch (error) {
    engineState.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
    console.error("[engine]", error);
  } finally {
    engineState.running = false;
  }
}
