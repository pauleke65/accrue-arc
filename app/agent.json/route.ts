import { CONTRACTS, ERC8004, chain } from "@/lib/arc";
import { setupState } from "@/lib/server/bootstrap";
import { json, publicBaseUrl } from "@/lib/server/http";
import { walletAddresses } from "@/lib/server/wallets";

export const dynamic = "force-dynamic";

/** The Proof Engine's ERC-8004 agent registration file (its agentURI). */
export async function GET(request: Request) {
  const base = publicBaseUrl(request);
  const engine = walletAddresses().engine;
  return json(
    {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Accrue Proof Engine",
      description:
        "Verifies delivered work for Accrue jobs on Arc. For each ERC-8183 job that names it on its AccruePanel, it " +
        "checks the evidence against the job's on-chain definition of done (a live page showing agreed text, a pull " +
        "request merged into an agreed repository, or an API returning an agreed value), optionally asks a model " +
        "whether the brief is met, and votes on chain with its full report. It abstains rather than guess, and it " +
        "never decides alone unless the client chose that.",
      image: `${base}/icon.svg`,
      services: [
        { name: "web", endpoint: base },
        { name: "agentWallet", endpoint: engine ? `eip155:${chain.id}:${engine}` : null },
        { name: "erc8183-evaluator", endpoint: `eip155:${chain.id}:${CONTRACTS.panel}` },
        { name: "erc8183-jobs", endpoint: `eip155:${chain.id}:${CONTRACTS.jobs}` },
      ],
      x402Support: false,
      active: true,
      registrations: setupState.agentId
        ? [{ agentId: Number(setupState.agentId), agentRegistry: `eip155:${chain.id}:${ERC8004.identity}` }]
        : [],
      supportedTrust: ["reputation", "validation"],
    },
    { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } },
  );
}
