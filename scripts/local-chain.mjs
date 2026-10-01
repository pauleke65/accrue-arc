#!/usr/bin/env node
// Turns a local anvil node into a stand-in for Arc mainnet, for development:
//   anvil --chain-id 5042 --port 8545
//   ACCRUE_KEY_SEED=<64 hex> node scripts/local-chain.mjs
//
// It puts a 6-decimal USDC with EIP-2612 permit (contracts/test/mocks) at
// Arc's USDC address, so the permit domain matches Arc's exactly, and funds the
// server's wallets. Anvil already has the CREATE2 factory Arc uses, so the
// server then deploys AccrueJobs and AccruePanel at their mainnet addresses.
//
// Note: on anvil, gas is paid in a separate native coin; on Arc the native coin
// is USDC itself. Both are funded here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createTestClient, http, keccak256, parseEther, stringToHex, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:8545";
const USDC = "0x3600000000000000000000000000000000000000";
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

const seed = process.env.ACCRUE_KEY_SEED?.trim().toLowerCase();
if (!seed || !/^[0-9a-f]{64}$/.test(seed)) throw new Error("Set ACCRUE_KEY_SEED to 64 hex characters (the same value the server uses).");

const chain = { ...arc, rpcUrls: { default: { http: [RPC] } } };
const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });

const mock = JSON.parse(readFileSync(join(root, "contracts/out/MockUSDC.sol/MockUSDC.json"), "utf8"));
await test.setCode({ address: USDC, bytecode: mock.deployedBytecode.object });

// Multicall3 is predeployed on Arc; copy its code so batched reads work locally.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const mainnet = createPublicClient({ chain: arc, transport: http(process.env.ARC_MAINNET_RPC ?? "https://rpc.mainnet.arc.io") });
const multicallCode = await mainnet.getCode({ address: MULTICALL3 });
if (multicallCode && multicallCode !== "0x") await test.setCode({ address: MULTICALL3, bytecode: multicallCode });

const factoryCode = await pub.getCode({ address: FACTORY });
if (!factoryCode || factoryCode === "0x") throw new Error("This node has no CREATE2 factory at " + FACTORY);

const names = ["ops", "engine", "demoA", "demoB"];
const wallets = Object.fromEntries(
  names.map((name) => [name, privateKeyToAccount(keccak256(stringToHex(`accrue-arc:${name}:${seed}`))).address]),
);

const extra = (process.env.FUND ?? "").split(",").filter(Boolean);
const mint = async (to, amount) => {
  const [funder] = await test.request({ method: "eth_accounts" });
  const hash = await test.request({
    method: "eth_sendTransaction",
    params: [{ from: funder, to: USDC, data: encodeFunctionData({ abi: mock.abi, functionName: "mint", args: [to, amount] }) }],
  });
  await pub.waitForTransactionReceipt({ hash });
};

for (const address of [...Object.values(wallets), ...extra]) {
  await test.setBalance({ address, value: parseEther("100") });
}
// 50 USDC by default; set OPS_USDC (in base units) to rehearse a lean launch.
await mint(wallets.ops, BigInt(process.env.OPS_USDC ?? "50000000"));
for (const address of extra) await mint(address, 1_000_000_000n); // 1,000 USDC for UI testing

console.log("USDC (mock with permit) at", USDC);
for (const [name, address] of Object.entries(wallets)) console.log(`${name.padEnd(6)} ${address}`);
for (const address of extra) console.log(`funded ${address} with 1,000 USDC`);
