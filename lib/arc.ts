import { arc, arcTestnet } from "viem/chains";
import { JOBS_ADDRESS, PANEL_ADDRESS } from "./abi";

/**
 * Arc mainnet, as published at docs.arc.io and confirmed against the chain:
 * chain 5042, USDC as the gas token, sub-second deterministic finality.
 * NEXT_PUBLIC_ARC_NETWORK=testnet points the whole app at Arc testnet
 * (chain 5042002) instead, for rehearsals and recordings.
 *
 * USDC has two views of one balance on Arc: the native gas balance (18
 * decimals) and the ERC-20 interface at 0x3600…0000 (6 decimals). Accrue moves
 * money only through the ERC-20 interface and shows a single USDC balance.
 */
export const TESTNET = process.env.NEXT_PUBLIC_ARC_NETWORK === "testnet";

export const chain = TESTNET ? arcTestnet : arc;

/** "Arc mainnet" or "Arc testnet", for copy. */
export const NETWORK_NAME = TESTNET ? "Arc testnet" : "Arc mainnet";

/**
 * The server reads ARC_RPC_URL at runtime; browsers get NEXT_PUBLIC_ARC_RPC_URL,
 * inlined at build time. Both default to Circle's public endpoint, which needs
 * no key and allows cross-origin requests.
 */
export const RPC_URL =
  (typeof window === "undefined" ? process.env.ARC_RPC_URL : undefined) ||
  process.env.NEXT_PUBLIC_ARC_RPC_URL ||
  (TESTNET ? "https://rpc.testnet.arc.network" : "https://rpc.mainnet.arc.io");

export const EXPLORER = TESTNET ? "https://testnet.arcscan.app" : "https://explorer.arc.io";

/** USDC sits at the same address, with the same permit domain, on both networks. */
export const USDC = {
  address: "0x3600000000000000000000000000000000000000",
  decimals: 6,
  symbol: "USDC",
} as const;

/** ERC-8004 registries Circle deployed on Arc (the testnet set differs). */
export const ERC8004 = TESTNET
  ? ({
      identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    } as const)
  : ({
      identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
    } as const);

export const CONTRACTS = {
  jobs: JOBS_ADDRESS,
  panel: PANEL_ADDRESS,
} as const;

/** Arc's mempool drops transactions priced under 20 gwei, silently. */
export const MIN_MAX_FEE_PER_GAS = 20_000_000_000n;

export const explorer = {
  tx: (hash: string) => `${EXPLORER}/tx/${hash}`,
  address: (address: string) => `${EXPLORER}/address/${address}`,
  block: (block: bigint | number) => `${EXPLORER}/block/${block}`,
};

/** Where people get USDC onto Arc: CCTP burns it on one chain and mints it here. */
export const BRIDGE_URL = "https://docs.arc.io/app-kit/bridge";
