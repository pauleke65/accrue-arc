import { CONTRACTS, ERC8004, chain } from "@/lib/arc";
import { aiConfigured, MODEL } from "@/lib/server/ai";
import { agentCardUrl, setupState, usdcBalance } from "@/lib/server/bootstrap";
import { demoAvailability } from "@/lib/server/demo";
import { engineState } from "@/lib/server/engine";
import { cached, json } from "@/lib/server/http";
import { walletAddresses, type WalletName } from "@/lib/server/wallets";

export const dynamic = "force-dynamic";

/** Everything about this deployment that is safe to publish. No secrets. */
export async function GET() {
  const addresses = walletAddresses();
  const balances = await cached("status-balances", 5_000, async () => {
    const entries = await Promise.all(
      (Object.entries(addresses) as [WalletName, `0x${string}`][]).map(async ([name, address]) => [
        name,
        { address, usdc: (await usdcBalance(address).catch(() => 0n)).toString() },
      ]),
    );
    return Object.fromEntries(entries);
  });
  return json({
    chainId: chain.id,
    contracts: { ...CONTRACTS, deployed: setupState.deployed, verified: setupState.verified },
    erc8004: { ...ERC8004, agentId: setupState.agentId, agentCard: agentCardUrl() },
    seed: setupState.seed,
    wallets: balances,
    ai: { configured: aiConfigured(), model: aiConfigured() ? MODEL : null },
    demo: demoAvailability(),
    setup: { lastRun: setupState.lastRun, lastError: setupState.lastError, log: setupState.log.slice(0, 15) },
    engine: {
      lastTick: engineState.lastTick,
      lastError: engineState.lastError,
      watching: engineState.active.size,
      votes: engineState.votes.slice(0, 10),
    },
  });
}
