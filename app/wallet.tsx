"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  parseSignature,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hex,
  type WalletClient,
} from "viem";
import { EXPLORER, MIN_MAX_FEE_PER_GAS, RPC_URL, TESTNET, USDC, chain } from "@/lib/arc";
import { readableError } from "@/lib/errors";
import { publicClient } from "@/lib/jobs";
import { createPasskeyAccount, openPasskeyAccount, type PasskeyWallet } from "@/lib/passkey";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export type Settled = { hash: Hex; ms: number; fee: bigint; label: string };

type Call = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] };

type WalletState = {
  address: Address | null;
  kind: "passkey" | "injected" | null;
  balance: bigint | null;
  connecting: boolean;
  error: string;
  sessionEndsAt: number | null;
  connectPasskey: (mode: "create" | "open") => Promise<void>;
  connectInjected: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  write: (call: Call, label: string) => Promise<Settled>;
  signPermit: (spender: Address, value: bigint, deadline: bigint) => Promise<{ v: number; r: Hex; s: Hex }>;
  last: Settled | null;
  clearLast: () => void;
};

const Context = createContext<WalletState | null>(null);

const ARC_PARAMS = {
  chainId: `0x${chain.id.toString(16)}`,
  chainName: TESTNET ? "Arc Testnet" : "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: [chain.rpcUrls.default.http[0]],
  blockExplorerUrls: [EXPLORER],
};

async function fees() {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const base = block.baseFeePerGas ?? MIN_MAX_FEE_PER_GAS;
  const tip = 1_000_000_000n;
  const doubled = base * 2n + tip;
  const floor = MIN_MAX_FEE_PER_GAS + tip;
  return { maxFeePerGas: doubled > floor ? doubled : floor, maxPriorityFeePerGas: tip };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [kind, setKind] = useState<WalletState["kind"]>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<Settled | null>(null);
  const [sessionEndsAt, setSessionEndsAt] = useState<number | null>(null);
  const passkey = useRef<PasskeyWallet | null>(null);
  const client = useRef<WalletClient | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const value = await publicClient.readContract({
        address: USDC.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      });
      setBalance(value);
    } catch {
      // Keep the last known balance on a transient read failure.
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const first = window.setTimeout(refreshBalance, 0);
    const timer = window.setInterval(refreshBalance, 10_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [address, refreshBalance]);

  const connectPasskey = useCallback(async (mode: "create" | "open") => {
    setConnecting(true);
    setError("");
    try {
      const wallet =
        mode === "create"
          ? await createPasskeyAccount(`Accrue ${new Date().toISOString().slice(0, 10)}`)
          : await openPasskeyAccount();
      passkey.current?.end();
      passkey.current = wallet;
      client.current = createWalletClient({ account: wallet.account, chain, transport: http(RPC_URL) });
      setAddress(wallet.account.address);
      setKind("passkey");
      setSessionEndsAt(wallet.expiresAt);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectInjected = useCallback(async () => {
    setConnecting(true);
    setError("");
    try {
      const provider = window.ethereum;
      if (!provider) throw new Error("No browser wallet found. Install one, or use a passkey instead.");
      const [account] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_PARAMS.chainId }] });
      } catch (switchError) {
        if ((switchError as { code?: number }).code === 4902 || /unrecognized|not added/i.test(String(switchError))) {
          await provider.request({ method: "wallet_addEthereumChain", params: [ARC_PARAMS] });
        } else {
          throw switchError;
        }
      }
      client.current = createWalletClient({ account: getAddress(account), chain, transport: custom(provider) });
      setAddress(getAddress(account));
      setKind("injected");
      setSessionEndsAt(null);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    passkey.current?.end();
    passkey.current = null;
    client.current = null;
    setAddress(null);
    setKind(null);
    setBalance(null);
    setSessionEndsAt(null);
  }, []);

  const ensureClient = useCallback(async (): Promise<WalletClient> => {
    if (kind === "passkey" && passkey.current && Date.now() > passkey.current.expiresAt - 5_000) {
      // The signing session ended: one more passkey prompt starts a new one.
      await connectPasskey("open");
    }
    if (!client.current || !address) throw new Error("Connect an account first.");
    return client.current;
  }, [address, kind, connectPasskey]);

  const write = useCallback(
    async (call: Call, label: string): Promise<Settled> => {
      const wallet = await ensureClient();
      const account = wallet.account ?? address!;
      const target = { address: call.address, abi: call.abi as Abi, functionName: call.functionName, args: call.args ?? [], account };
      // Simulating first turns a revert into a readable reason before any fee is spent.
      await publicClient.simulateContract(target);
      const gas = await publicClient.estimateContractGas(target);
      const data = encodeFunctionData({ abi: target.abi, functionName: target.functionName, args: target.args });
      const sentAt = Date.now();
      const hash = await wallet.sendTransaction({ account, chain, to: call.address, data, gas: (gas * 12n) / 10n, ...(await fees()) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      const settled = { hash, ms: Date.now() - sentAt, fee: receipt.gasUsed * receipt.effectiveGasPrice, label };
      setLast(settled);
      void refreshBalance();
      return settled;
    },
    [address, ensureClient, refreshBalance],
  );

  const signPermit = useCallback(
    async (spender: Address, value: bigint, deadline: bigint) => {
      const wallet = await ensureClient();
      const owner = address!;
      const nonce = await publicClient.readContract({
        address: USDC.address,
        abi: [{ type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "nonces",
        args: [owner],
      });
      const signature = await wallet.signTypedData({
        account: wallet.account ?? owner,
        domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC.address },
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
        message: { owner, spender, value, nonce, deadline },
      });
      const { v, r, s, yParity } = parseSignature(signature);
      return { v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };
    },
    [address, ensureClient],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      kind,
      balance,
      connecting,
      error,
      sessionEndsAt,
      connectPasskey,
      connectInjected,
      disconnect,
      refreshBalance,
      write,
      signPermit,
      last,
      clearLast: () => setLast(null),
    }),
    [address, kind, balance, connecting, error, sessionEndsAt, connectPasskey, connectInjected, disconnect, refreshBalance, write, signPermit, last],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWallet(): WalletState {
  const value = useContext(Context);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
