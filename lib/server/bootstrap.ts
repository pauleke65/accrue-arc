import { decodeEventLog, erc20Abi, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { CONTRACTS, ERC8004, USDC } from "../arc";
import { publicClient } from "../jobs";
import initcode from "./initcode.json" with { type: "json" };
import { send, write } from "./tx";
import { ensureVerified, type VerifyState } from "./verify";
import { account, seedStatus, type WalletName } from "./wallets";

/**
 * Setup the server finishes on its own once its ops wallet holds USDC:
 *   1. deploy AccrueJobs and AccruePanel through Arc's CREATE2 factory, at
 *      addresses fixed by their code (see lib/abi.ts);
 *   2. keep the Proof Engine and demo wallets topped up from ops;
 *   3. register the Proof Engine as an ERC-8004 agent.
 * Every step checks the chain first, so it is safe to run on every tick.
 */

export const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const USDC_UNIT = 10n ** BigInt(USDC.decimals);

/*
 * Funding is kept lean so the whole setup runs on well under 1 USDC. Measured
 * on Arc at its 20 gwei floor: deploying both contracts costs ~0.084 USDC, the
 * ERC-8004 registration ~0.005, a vote ~0.004, and a demo run ~0.02 in fees
 * (its 0.10 budget only moves between the two demo wallets). A sender must
 * also hold gas limit × max fee up front, so balances keep that headroom.
 */
const milli = (n: bigint) => (n * USDC_UNIT) / 1000n;
/** The live demo's job budget: 0.10 USDC. */
export const DEMO_BUDGET = milli(100n);
/** Never spend ops below this: it pays the next top-up and first-fee stipends. */
export const OPS_RESERVE = milli(20n);
/** The Proof Engine refills from 0.015 to 0.05 USDC (registration plus ~10 votes). */
const ENGINE = { min: milli(15n), target: milli(50n) };
/** One demo wallet must cover the budget plus the post's up-front gas; the other only a submit. */
const DEMO_CLIENT = { min: DEMO_BUDGET + milli(40n), target: DEMO_BUDGET + milli(60n) };
const DEMO_WORKER = { min: milli(10n), target: milli(20n) };

export type SetupState = {
  seed: "ok" | "missing" | "invalid";
  deployed: { jobs: boolean; panel: boolean };
  /** Source verification on the explorer, per contract. */
  verified: VerifyState;
  agentId: string | null;
  lastError: string | null;
  lastRun: number | null;
  log: { at: number; message: string; tx?: Hex }[];
};

const g = globalThis as unknown as { __accrueSetup?: SetupState };
export const setupState: SetupState = (g.__accrueSetup ??= {
  seed: seedStatus(),
  deployed: { jobs: false, panel: false },
  verified: {},
  agentId: process.env.ACCRUE_ENGINE_AGENT_ID ?? null,
  lastError: null,
  lastRun: null,
  log: [],
});

function note(message: string, tx?: Hex) {
  setupState.log.unshift({ at: Math.floor(Date.now() / 1000), message, tx });
  setupState.log.length = Math.min(setupState.log.length, 40);
  console.log(`[setup] ${message}${tx ? ` ${tx}` : ""}`);
}

export async function usdcBalance(address: Address): Promise<bigint> {
  return publicClient.readContract({ address: USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

async function hasCode(address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return !!code && code !== "0x";
}

async function ensureDeployed(): Promise<void> {
  for (const key of ["jobs", "panel"] as const) {
    const target = initcode[key];
    if (await hasCode(target.address as Address)) {
      setupState.deployed[key] = true;
      continue;
    }
    // The factory takes the salt followed by the creation code.
    const data = (initcode.salt + target.initCode.slice(2)) as Hex;
    const sent = await send("ops", { to: initcode.factory as Address, data });
    if (!(await hasCode(target.address as Address))) throw new Error(`Deploying ${key} did not create code`);
    setupState.deployed[key] = true;
    note(`Deployed ${key === "jobs" ? "AccrueJobs" : "AccruePanel"} at ${target.address}`, sent.hash);
  }
}

async function topUp(name: WalletName, rule: { min: bigint; target: bigint }, balance: bigint): Promise<void> {
  if (balance >= rule.min) return;
  const amount = rule.target - balance;
  if ((await usdcBalance(account("ops").address)) < amount + OPS_RESERVE) return;
  const sent = await write("ops", {
    address: USDC.address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [account(name).address, amount],
  });
  note(`Topped up ${name} with ${Number(amount) / 1e6} USDC`, sent.hash);
}

async function ensureTopUps(): Promise<void> {
  await topUp("engine", ENGINE, await usdcBalance(account("engine").address));
  // The demo budget moves between the two wallets, so fund the pair, not each.
  const [a, b] = await Promise.all([usdcBalance(account("demoA").address), usdcBalance(account("demoB").address)]);
  const [rich, richBalance, poor, poorBalance]: [WalletName, bigint, WalletName, bigint] =
    a >= b ? ["demoA", a, "demoB", b] : ["demoB", b, "demoA", a];
  await topUp(rich, DEMO_CLIENT, richBalance);
  await topUp(poor, DEMO_WORKER, poorBalance);
}

export function agentCardUrl(): string | null {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}/agent.json` : null;
}

/**
 * The registry is not enumerable, so after a restart the agent id comes from
 * ACCRUE_ENGINE_AGENT_ID or, failing that, from the mint event, searched
 * backwards in the RPC's 10,000-block windows (about three days in all).
 */
async function findAgentId(engine: Address): Promise<string | null> {
  const head = await publicClient.getBlockNumber();
  for (let i = 0n; i < 180n; i++) {
    const toBlock = head - i * 9_999n;
    if (toBlock <= 0n) break;
    const fromBlock = toBlock > 9_998n ? toBlock - 9_998n : 0n;
    const logs = await publicClient.getLogs({
      address: ERC8004.identity,
      event: identityAbi[4],
      args: { from: zeroAddress, to: engine },
      fromBlock,
      toBlock,
    });
    if (logs.length) return logs[logs.length - 1].args.tokenId!.toString();
  }
  return null;
}

let agentScanDone = false;

async function ensureAgent(): Promise<void> {
  if (setupState.agentId) return;
  if (!(await hasCode(ERC8004.identity))) return; // no ERC-8004 registry on this chain
  const engine = account("engine").address;
  const owned = await publicClient.readContract({
    address: ERC8004.identity,
    abi: identityAbi,
    functionName: "balanceOf",
    args: [engine],
  });
  if (owned > 0n) {
    if (!agentScanDone) {
      agentScanDone = true;
      setupState.agentId = await findAgentId(engine);
    }
    return;
  }
  const uri = agentCardUrl();
  if (!uri || (await usdcBalance(engine)) === 0n) return;
  const sent = await write("engine", {
    address: ERC8004.identity,
    abi: identityAbi,
    functionName: "register",
    args: [uri],
  });
  for (const log of sent.receipt.logs) {
    if (log.address.toLowerCase() !== ERC8004.identity.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
      if (event.eventName === "Transfer" && event.args.from === zeroAddress) {
        setupState.agentId = event.args.tokenId.toString();
      }
    } catch {
      // Not the Transfer event.
    }
  }
  note(`Registered the Proof Engine as ERC-8004 agent #${setupState.agentId ?? "?"}`, sent.hash);
}

/** One setup pass. Stops at the first step that cannot proceed yet. */
let lastVerify = 0;

export async function runSetup(): Promise<void> {
  setupState.seed = seedStatus();
  setupState.lastRun = Math.floor(Date.now() / 1000);
  if (setupState.seed !== "ok") return;
  try {
    const ops = account("ops").address;
    if (!(setupState.deployed.jobs && setupState.deployed.panel)) {
      const deployed = (await hasCode(CONTRACTS.jobs)) && (await hasCode(CONTRACTS.panel));
      if (!deployed && (await usdcBalance(ops)) === 0n) return; // waiting for the first USDC
      await ensureDeployed();
    }
    await ensureTopUps();
    await ensureAgent();
    if (Date.now() - lastVerify > 60_000) {
      lastVerify = Date.now();
      await ensureVerified(setupState.verified);
    }
    setupState.lastError = null;
  } catch (error) {
    setupState.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
    console.error("[setup]", error);
  }
}
