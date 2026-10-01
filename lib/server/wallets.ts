import { createWalletClient, http, keccak256, stringToHex, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC_URL } from "../arc";

/**
 * The server's own accounts, derived from ACCRUE_KEY_SEED: a random secret
 * Railway generated and holds. No private key is ever written to the
 * repository, typed into a dashboard or seen by a person.
 *
 *   ops     deploys the contracts, tops up the others, covers first fees
 *   engine  the Proof Engine: votes on jobs that name it as a reviewer
 *   demoA   with demoB, the client and worker of the live demo, taking
 *   demoB   turns so the demo's USDC goes back and forth instead of leaking
 */
export type WalletName = "ops" | "engine" | "demoA" | "demoB";
export const WALLET_NAMES: WalletName[] = ["ops", "engine", "demoA", "demoB"];

export function seedStatus(): "ok" | "missing" | "invalid" {
  const seed = process.env.ACCRUE_KEY_SEED;
  if (!seed) return "missing";
  return /^[0-9a-f]{64}$/i.test(seed.trim()) ? "ok" : "invalid";
}

const cache = new Map<WalletName, PrivateKeyAccount>();

export function account(name: WalletName): PrivateKeyAccount {
  const cached = cache.get(name);
  if (cached) return cached;
  if (seedStatus() !== "ok") throw new Error("ACCRUE_KEY_SEED is not configured");
  const seed = process.env.ACCRUE_KEY_SEED!.trim().toLowerCase();
  const key = keccak256(stringToHex(`accrue-arc:${name}:${seed}`)) as Hex;
  const derived = privateKeyToAccount(key);
  cache.set(name, derived);
  return derived;
}

export function walletClient(name: WalletName) {
  return createWalletClient({ account: account(name), chain, transport: http(RPC_URL, { timeout: 30_000 }) });
}

/** Addresses only, safe to publish. */
export function walletAddresses(): Partial<Record<WalletName, `0x${string}`>> {
  if (seedStatus() !== "ok") return {};
  return Object.fromEntries(WALLET_NAMES.map((n) => [n, account(n).address]));
}

// One transaction at a time per wallet, so nonces never collide between the
// keeper loop, the demo and the sponsor.
const queues = new Map<WalletName, Promise<unknown>>();

export function serialized<T>(name: WalletName, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(
    name,
    next.catch(() => undefined),
  );
  return next;
}
