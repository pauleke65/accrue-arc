import { decodeEventLog, parseSignature, type Hex } from "viem";
import { CONTRACTS, USDC } from "../arc";
import { jobsAbi } from "../abi";
import { publicClient } from "../jobs";
import { encodeBrief, encodePanel, encodeEvidence, expiryFor, type Brief } from "../policy";
import { DEMO_BUDGET, setupState, usdcBalance } from "./bootstrap";
import { evaluateAndVote } from "./engine";
import { write } from "./tx";
import { account, seedStatus, type WalletName } from "./wallets";

/**
 * The live demo: a real job on Arc mainnet, played by two server wallets that
 * swap client and worker each run, so the 0.10 USDC budget moves back and
 * forth and only network fees are spent. The worker "delivers" a page this
 * app serves at /proof/<nonce>; the Proof Engine fetches it like any other
 * evidence and votes. Every step is a real transaction with its own hash.
 */

export { DEMO_BUDGET };
const COOLDOWN_MS = 12_000;
const DAILY_CAP = 60; // at ~0.02 USDC in fees per run

export type DemoStep = {
  key: "post" | "deliver" | "check" | "pay";
  label: string;
  status: "pending" | "running" | "done" | "failed";
  tx?: Hex;
  ms?: number;
  fee?: string; // native USDC wei, as a string
  detail?: string;
};

export type DemoRun = {
  id: string;
  startedAt: number;
  finishedAt?: number;
  jobId?: number;
  client: `0x${string}`;
  worker: `0x${string}`;
  proofUrl: string;
  steps: DemoStep[];
  error?: string;
};

type DemoState = { runs: Map<string, DemoRun>; order: string[]; count: number; day: string; today: number; busy: boolean; last: number };
const g = globalThis as unknown as { __accrueDemo?: DemoState };
const state: DemoState = (g.__accrueDemo ??= {
  runs: new Map(),
  order: [],
  count: 0,
  day: "",
  today: 0,
  busy: false,
  last: 0,
});

/** Pages the demo worker publishes; served by app/proof/[nonce]. */
export function proofText(nonce: string): string {
  return `Accrue proof ${nonce}`;
}

export function getRun(id: string): DemoRun | null {
  return state.runs.get(id) ?? null;
}

export function demoAvailability(): { ok: boolean; reason?: string } {
  if (seedStatus() !== "ok") return { ok: false, reason: "The server has no wallets configured yet." };
  if (!(setupState.deployed.jobs && setupState.deployed.panel)) return { ok: false, reason: "The contracts are not deployed yet." };
  if (state.busy) return { ok: false, reason: "A demo job is running right now. Watch it, or try again in a few seconds." };
  if (Date.now() - state.last < COOLDOWN_MS) return { ok: false, reason: "Another demo just finished. Try again in a few seconds." };
  const day = new Date().toISOString().slice(0, 10);
  if (state.day === day && state.today >= DAILY_CAP) return { ok: false, reason: "Today's live demos are used up. Every past run is on the job board." };
  return { ok: true };
}

export async function startDemo(baseUrl: string): Promise<DemoRun> {
  const availability = demoAvailability();
  if (!availability.ok) throw new Error(availability.reason);
  state.busy = true;
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.today = 0;
  }
  state.today++;

  const [clientName, workerName]: [WalletName, WalletName] = state.count % 2 === 0 ? ["demoA", "demoB"] : ["demoB", "demoA"];
  state.count++;
  const client = account(clientName);
  const worker = account(workerName);
  // Whichever wallet holds the budget plays the client.
  const release = (message: string) => {
    state.busy = false;
    state.today--;
    return new Error(message);
  };
  const [clientBalance, workerBalance] = await Promise.all([usdcBalance(client.address), usdcBalance(worker.address)]).catch(() => {
    throw release("Arc's RPC did not answer. Try again in a few seconds.");
  });
  // The post needs the budget plus its up-front gas; the other side only a submit.
  const richest = clientBalance > workerBalance ? clientBalance : workerBalance;
  const poorest = clientBalance > workerBalance ? workerBalance : clientBalance;
  if (richest < DEMO_BUDGET + 35_000n || poorest < 6_000n) throw release("The demo accounts are being topped up. Try again in a minute.");
  const swap = clientBalance < DEMO_BUDGET + 35_000n && workerBalance > clientBalance;
  const c = swap ? worker : client;
  const w = swap ? client : worker;
  const cName = swap ? workerName : clientName;
  const wName = swap ? clientName : workerName;

  const nonce = Math.random().toString(16).slice(2, 10);
  // Local development only: a chain on localhost has no public page to fetch.
  const override = process.env.ACCRUE_LOCAL_DEV === "1" ? process.env.ACCRUE_DEMO_URL_OVERRIDE : undefined;
  const proofUrl = override ?? `${baseUrl.replace(/\/$/, "")}/proof/${nonce}`;
  const text = override ? (process.env.ACCRUE_DEMO_TEXT_OVERRIDE ?? "Example Domain") : proofText(nonce);
  const host = new URL(proofUrl).hostname;

  const run: DemoRun = {
    id: nonce,
    startedAt: Date.now(),
    client: c.address,
    worker: w.address,
    proofUrl,
    steps: [
      { key: "post", label: "Client posts the job and locks 0.10 USDC", status: "pending" },
      { key: "deliver", label: "Worker publishes the page and submits it", status: "pending" },
      { key: "check", label: "Proof Engine checks the page", status: "pending" },
      { key: "pay", label: "Proof Engine votes; the contract pays the worker", status: "pending" },
    ],
  };
  state.runs.set(run.id, run);
  state.order.unshift(run.id);
  for (const old of state.order.splice(30)) state.runs.delete(old);

  void play(run, cName, wName, text, host).finally(() => {
    state.busy = false;
    state.last = Date.now();
  });
  return run;
}

function step(run: DemoRun, key: DemoStep["key"]): DemoStep {
  return run.steps.find((s) => s.key === key)!;
}

async function play(run: DemoRun, clientName: WalletName, workerName: WalletName, text: string, host: string) {
  const current: { s?: DemoStep } = {};
  try {
    const engine = account("engine").address;
    const client = account(clientName);
    const now = Math.floor(Date.now() / 1000);
    const deliverBy = now + 3600;
    const reviewWindow = 3600;
    const brief: Brief = {
      v: 1,
      app: "accrue",
      title: `Live demo: publish proof ${run.id}`,
      brief: `Publish a public page that shows the phrase “${text}”. The Proof Engine fetches it and pays on sight.`,
      check: { kind: "webpage", text, host },
    };

    // 1. Post and fund in one transaction, approving with a permit signature.
    current.s = step(run, "post");
    current.s.status = "running";
    const deadline = BigInt(now + 1800);
    const nonce = await publicClient.readContract({
      address: USDC.address,
      abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "nonces",
      args: [client.address],
    });
    const signature = await client.signTypedData({
      domain: { name: "USDC", version: "2", chainId: 5042, verifyingContract: USDC.address },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: client.address, spender: CONTRACTS.jobs, value: DEMO_BUDGET, nonce, deadline },
    });
    const { v, r, s } = parseSignature(signature);
    const posted = await write(clientName, {
      address: CONTRACTS.jobs,
      abi: jobsAbi,
      functionName: "createAndFundWithPermit",
      args: [
        {
          provider: account(workerName).address,
          evaluator: CONTRACTS.panel,
          expiredAt: BigInt(expiryFor(deliverBy, reviewWindow)),
          description: encodeBrief(brief),
          hook: CONTRACTS.panel,
          budget: DEMO_BUDGET,
          budgetParams: encodePanel({ reviewers: [engine], threshold: 1, reviewWindow, deliverBy }),
          fundParams: "0x",
        },
        deadline,
        Number(v ?? 27n),
        r,
        s,
      ],
    });
    for (const log of posted.receipt.logs) {
      if (log.address.toLowerCase() !== CONTRACTS.jobs.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: jobsAbi, data: log.data, topics: log.topics });
        if (event.eventName === "JobCreated") run.jobId = Number(event.args.jobId);
      } catch {
        // Another event in the same transaction.
      }
    }
    if (!run.jobId) throw new Error("The job was created but its id was not in the receipt");
    Object.assign(current.s, { status: "done", tx: posted.hash, ms: posted.ms, fee: posted.fee.toString(), detail: `Job #${run.jobId}` });

    // 2. Deliver: the page already exists at /proof/<nonce>; submit it.
    current.s = step(run, "deliver");
    current.s.status = "running";
    const evidence = encodeEvidence({ v: 1, url: run.proofUrl, notes: "Live demo delivery" });
    const delivered = await write(workerName, {
      address: CONTRACTS.jobs,
      abi: jobsAbi,
      functionName: "submit",
      args: [BigInt(run.jobId), evidence.deliverable, evidence.optParams],
    });
    Object.assign(current.s, { status: "done", tx: delivered.hash, ms: delivered.ms, fee: delivered.fee.toString(), detail: run.proofUrl });

    // 3 and 4. The engine fetches the page, then votes; a pass pays at once.
    current.s = step(run, "check");
    current.s.status = "running";
    const checkStarted = Date.now();
    const pay = step(run, "pay");
    pay.status = "running";
    const { evaluation, sent } = await evaluateAndVote(run.jobId);
    Object.assign(current.s, {
      status: evaluation.verdict === "pass" ? "done" : "failed",
      ms: Date.now() - checkStarted - (sent?.ms ?? 0),
      detail: evaluation.reason,
    });
    current.s = pay;
    if (!sent) throw new Error(`The Proof Engine abstained: ${evaluation.reason}`);
    Object.assign(pay, {
      status: evaluation.verdict === "pass" ? "done" : "failed",
      tx: sent.hash,
      ms: sent.ms,
      fee: sent.fee.toString(),
      detail: evaluation.verdict === "pass" ? "0.10 USDC released to the worker" : "Refunded to the client",
    });
  } catch (error) {
    run.error = error instanceof Error ? error.message.slice(0, 300) : String(error);
    if (current.s && current.s.status === "running") current.s.status = "failed";
    for (const s of run.steps) if (s.status === "running") s.status = "failed";
    console.error("[demo]", error);
  } finally {
    run.finishedAt = Date.now();
  }
}
