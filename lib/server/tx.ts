import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { encodeFunctionData } from "viem";
import { MIN_MAX_FEE_PER_GAS } from "../arc";
import { publicClient } from "../jobs";
import { account, serialized, walletClient, type WalletName } from "./wallets";

export type Sent = {
  hash: Hex;
  receipt: TransactionReceipt;
  /** Wall-clock time from broadcast to a final receipt. */
  ms: number;
  /** Network fee in native USDC (18 decimals). */
  fee: bigint;
};

/**
 * EIP-1559 fees for Arc. The next base fee is never under 20 gwei, and a
 * transaction capped below that is dropped without an error, so the cap is
 * twice the current base fee and never less than the floor plus the tip.
 */
export async function fees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? MIN_MAX_FEE_PER_GAS;
  const tip = 1_000_000_000n;
  const doubled = base * 2n + tip;
  const floor = MIN_MAX_FEE_PER_GAS + tip;
  return { maxFeePerGas: doubled > floor ? doubled : floor, maxPriorityFeePerGas: tip };
}

async function confirm(hash: Hex, sentAt: number): Promise<Sent> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 60_000 });
  const ms = Date.now() - sentAt;
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return { hash, receipt, ms, fee: receipt.gasUsed * receipt.effectiveGasPrice };
}

/** Sends a contract call from a server wallet and waits for finality (under a second on Arc). */
export function write(
  name: WalletName,
  call: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] },
): Promise<Sent> {
  return serialized(name, async () => {
    const client = walletClient(name);
    const data = encodeFunctionData({
      abi: call.abi as Abi,
      functionName: call.functionName,
      args: call.args ?? [],
    });
    // Simulate first, so a revert surfaces with its reason instead of costing gas.
    await publicClient.call({ account: account(name).address, to: call.address, data });
    const gas = await publicClient.estimateGas({ account: account(name).address, to: call.address, data });
    const sentAt = Date.now();
    const hash = await client.sendTransaction({
      to: call.address,
      data,
      gas: (gas * 12n) / 10n,
      ...(await fees()),
    });
    return confirm(hash, sentAt);
  });
}

/** Raw transaction from a server wallet (used for the CREATE2 factory). */
export function send(name: WalletName, tx: { to: Address; data: Hex; value?: bigint }): Promise<Sent> {
  return serialized(name, async () => {
    const client = walletClient(name);
    const gas = await publicClient.estimateGas({ account: account(name).address, ...tx });
    const sentAt = Date.now();
    const hash = await client.sendTransaction({ ...tx, gas: (gas * 12n) / 10n, ...(await fees()) });
    return confirm(hash, sentAt);
  });
}
