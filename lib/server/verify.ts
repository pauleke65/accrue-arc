import { CONTRACTS, EXPLORER } from "../arc";
import jobsInput from "../../contracts/verify/AccrueJobs.json" with { type: "json" };
import panelInput from "../../contracts/verify/AccruePanel.json" with { type: "json" };

/**
 * Publishes the contracts' source on the explorer once they are deployed, so
 * anyone can read the code behind the addresses. Blockscout recompiles the
 * standard JSON input (written by `forge verify-contract
 * --show-standard-json-input`) and compares it with the code on chain.
 */

const COMPILER = "v0.8.30+commit.73712a01";
const TARGETS = [
  { name: "AccrueJobs", address: CONTRACTS.jobs, input: jobsInput },
  { name: "AccruePanel", address: CONTRACTS.panel, input: panelInput },
] as const;

export type VerifyState = Record<string, "verified" | "submitted" | `failed: ${string}`>;

async function isVerified(address: string): Promise<boolean> {
  const response = await fetch(`${EXPLORER}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return false;
  const body = (await response.json()) as { is_verified?: boolean };
  return body.is_verified === true;
}

async function submit(name: string, address: string, input: unknown): Promise<void> {
  const form = new FormData();
  form.set("compiler_version", COMPILER);
  form.set("contract_name", name);
  form.set("license_type", "mit");
  form.set("autodetect_constructor_args", "true");
  form.set("files[0]", new Blob([JSON.stringify(input)], { type: "application/json" }), `${name}.json`);
  const response = await fetch(`${EXPLORER}/api/v2/smart-contracts/${address}/verification/via/standard-input`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 160)}`);
}

/** Checks each contract and submits the ones the explorer hasn't verified yet. */
export async function ensureVerified(state: VerifyState): Promise<void> {
  for (const { name, address, input } of TARGETS) {
    if (state[name] === "verified") continue;
    try {
      if (await isVerified(address)) {
        state[name] = "verified";
      } else if (state[name] !== "submitted") {
        await submit(name, address, input);
        state[name] = "submitted";
      }
    } catch (error) {
      state[name] = `failed: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}`;
    }
  }
}
