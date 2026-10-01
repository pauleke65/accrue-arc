import { erc20Abi, getAddress, isAddress, type Hex } from "viem";
import { USDC } from "../arc";
import { readJobs } from "../jobs";
import { OPS_RESERVE, setupState, usdcBalance } from "./bootstrap";
import { write } from "./tx";
import { account, seedStatus } from "./wallets";

/**
 * First fee, covered. On Arc the network fee is paid in USDC, so a worker who
 * has never held any cannot submit their first delivery, and a new reviewer
 * cannot vote. The server sends a one-time 0.02 USDC (a few transactions'
 * worth) to someone named on a funded job of at least 1 USDC. Gaming it means
 * locking more USDC in a job than the stipend is worth.
 */

const STIPEND = 20_000n; // 0.02 USDC
const NEEDS_BELOW = 10_000n; // 0.01 USDC
const MIN_BUDGET = 1_000_000n; // 1 USDC
const DAILY_CAP = 60;

type SponsorState = { given: Set<string>; day: string; today: number };
const g = globalThis as unknown as { __accrueSponsor?: SponsorState };
const state: SponsorState = (g.__accrueSponsor ??= { given: new Set(), day: "", today: 0 });

export async function sponsor(addressInput: string, jobId: number): Promise<{ tx: Hex | null; message: string }> {
  if (seedStatus() !== "ok" || !(setupState.deployed.jobs && setupState.deployed.panel))
    return { tx: null, message: "Sponsorship is not available yet." };
  if (!isAddress(addressInput)) return { tx: null, message: "That is not an address." };
  const address = getAddress(addressInput);
  const [job] = await readJobs([jobId]);
  if (!job || !job.governed || !job.panel) return { tx: null, message: "That is not an Accrue job." };
  if (job.status !== "Funded" && job.status !== "Submitted")
    return { tx: null, message: "Only people on a funded job can have their first fee covered." };
  if (BigInt(job.budget) < MIN_BUDGET) return { tx: null, message: "First fees are covered on jobs of 1 USDC or more." };

  const lower = address.toLowerCase();
  const isProvider = job.provider?.toLowerCase() === lower && job.status === "Funded";
  const isReviewer =
    job.status === "Submitted" &&
    job.panel.reviewers.some((r) => r.toLowerCase() === lower) &&
    lower !== account("engine").address.toLowerCase();
  if (!isProvider && !isReviewer) return { tx: null, message: "Only this job's worker or reviewers can ask." };
  if (state.given.has(lower)) return { tx: null, message: "This account's first fee was already covered." };
  if ((await usdcBalance(address)) >= NEEDS_BELOW) return { tx: null, message: "This account can already pay its fees." };

  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.today = 0;
  }
  if (state.today >= DAILY_CAP) return { tx: null, message: "Today's covered fees are used up. Add a little USDC to continue." };

  if ((await usdcBalance(account("ops").address)) < STIPEND + OPS_RESERVE)
    return { tx: null, message: "Covered fees are paused while Accrue tops up. Add a little USDC to continue." };

  state.given.add(lower);
  state.today++;
  try {
    const sent = await write("ops", {
      address: USDC.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [address, STIPEND],
    });
    return { tx: sent.hash, message: "Sent 0.02 USDC to cover your first network fees." };
  } catch (error) {
    state.given.delete(lower);
    state.today--;
    throw error;
  }
}
