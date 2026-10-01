"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Fingerprint, LogOut, Wallet, X, Zap } from "lucide-react";
import { useWallet } from "@/app/wallet";
import { BRIDGE_URL, CONTRACTS, explorer } from "@/lib/arc";
import { formatFee, formatUsdc, shortAddress } from "@/lib/format";
import { hasRememberedPasskey, passkeysAvailable } from "@/lib/passkey";
import { AddressLink, Button, CopyButton, TxLink } from "./ui";

const NAV = [
  { href: "/jobs", label: "Jobs" },
  { href: "/post", label: "Post a job" },
  { href: "/agents", label: "For agents" },
  { href: "/status", label: "Status" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#4C8DFF" />
        <path d="M9 22.5 15.2 9h1.6L23 22.5h-3.1l-1.3-3h-5.2l-1.3 3H9Zm5.4-5.6h3.2L16 13.1l-1.6 3.8Z" fill="#fff" />
        <circle cx="24.5" cy="9" r="3" fill="#3DDC97" />
      </svg>
      <span className="text-[1.05rem]">Accrue</span>
      <span className="hidden rounded-full border border-line px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-dim sm:inline">
        on Arc
      </span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  pathname.startsWith(item.href) ? "bg-raised text-ink" : "text-dim hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <AccountButton />
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={`whitespace-nowrap rounded-lg px-3 py-1 text-sm ${pathname.startsWith(item.href) ? "bg-raised text-ink" : "text-dim"}`}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function AccountButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={panel}>
      {wallet.address ? (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 rounded-[10px] border border-line-strong bg-raised px-3 py-1.5 text-sm hover:border-accent/50">
          <span className="num text-paid">{wallet.balance === null ? "…" : formatUsdc(wallet.balance)}</span>
          <span className="text-faint">USDC</span>
          <span className="mono text-dim">{shortAddress(wallet.address)}</span>
        </button>
      ) : (
        <Button size="sm" onClick={() => setOpen(!open)} busy={wallet.connecting}>
          Sign in
        </Button>
      )}
      {open && (
        <div className="card absolute right-0 top-12 z-40 w-[22rem] max-w-[calc(100vw-2rem)] p-4 shadow-2xl shadow-black/50 rise">
          {wallet.address ? <AccountPanel onClose={() => setOpen(false)} /> : <ConnectPanel />}
        </div>
      )}
    </div>
  );
}

const noSubscribe = () => () => {};

export function ConnectPanel() {
  const wallet = useWallet();
  // Browser-only facts: false while rendering on the server, read once on the client.
  const canPasskey = useSyncExternalStore(noSubscribe, passkeysAvailable, () => false);
  const returning = useSyncExternalStore(noSubscribe, hasRememberedPasskey, () => false);
  return (
    <div className="space-y-3">
      <div>
        <div className="font-semibold">Sign in to Accrue</div>
        <p className="mt-1 text-sm text-dim">Your account is an Arc address you control. Accrue never holds your keys or your USDC.</p>
      </div>
      {canPasskey && (
        <>
          <Button className="w-full" onClick={() => wallet.connectPasskey(returning ? "open" : "create")} busy={wallet.connecting}>
            <Fingerprint className="size-4" /> {returning ? "Sign in with your passkey" : "Create an account with a passkey"}
          </Button>
          <button className="w-full text-center text-xs text-dim hover:text-ink" onClick={() => wallet.connectPasskey(returning ? "create" : "open")}>
            {returning ? "Create a new passkey account instead" : "I already have a passkey account"}
          </button>
        </>
      )}
      <Button variant="secondary" className="w-full" onClick={wallet.connectInjected} busy={wallet.connecting}>
        <Wallet className="size-4" /> Connect a browser wallet
      </Button>
      {wallet.error && <p className="text-sm text-refund">{wallet.error}</p>}
      <p className="text-xs text-faint">No seed phrase with a passkey: the account is derived on your device and comes back wherever your passkey syncs.</p>
    </div>
  );
}

function AccountPanel({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const empty = wallet.balance !== null && wallet.balance === 0n;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">{wallet.kind === "passkey" ? "Passkey account" : "Browser wallet"}</div>
          <div className="mt-1 flex items-center gap-2">
            <AddressLink address={wallet.address!} />
          </div>
        </div>
        <button onClick={onClose} className="text-faint hover:text-ink" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="rounded-[10px] border border-line bg-page px-3.5 py-3">
        <div className="eyebrow">Balance</div>
        <div className="mt-1 num text-2xl font-semibold text-paid">
          {wallet.balance === null ? "…" : formatUsdc(wallet.balance)} <span className="text-sm text-dim">USDC</span>
        </div>
        <p className="mt-1 text-xs text-faint">On Arc, USDC also pays network fees: there is no second token to buy.</p>
      </div>
      {empty && (
        <div className="space-y-2 text-sm">
          <p className="text-dim">
            To post a job, send USDC to this address on <strong className="text-ink">Arc</strong> (chain 5042). Bridge it from another chain with Circle&apos;s
            CCTP, or withdraw from an exchange that supports Arc.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-page px-3 py-2">
            <span className="mono truncate text-xs">{wallet.address}</span>
            <CopyButton text={wallet.address!} />
          </div>
          <a href={BRIDGE_URL} target="_blank" rel="noreferrer" className="link text-xs">
            How to bring USDC to Arc →
          </a>
          <p className="text-xs text-faint">Working, not hiring? You don&apos;t need any: the first network fee on a funded job is covered.</p>
        </div>
      )}
      {wallet.kind === "passkey" && wallet.sessionEndsAt && (
        <p className="text-xs text-faint">Signing stays open for 15 minutes; after that, one more passkey prompt.</p>
      )}
      <Button variant="ghost" size="sm" onClick={() => { wallet.disconnect(); onClose(); }}>
        <LogOut className="size-4" /> Sign out
      </Button>
    </div>
  );
}

export function SettledToast() {
  const { last, clearLast } = useWallet();
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(clearLast, 9_000);
    return () => clearTimeout(timer);
  }, [last, clearLast]);
  if (!last) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rise">
      <div className="card flex items-center gap-3 border-paid/30 px-4 py-3 shadow-2xl shadow-black/60">
        <Zap className="size-5 shrink-0 text-paid" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">
            {last.label}: final on Arc in <span className="num text-paid">{(last.ms / 1000).toFixed(2)} s</span>
          </div>
          <div className="text-xs text-dim">
            Network fee <span className="num">{formatFee(last.fee)}</span>, paid in USDC · <TxLink hash={last.hash} />
          </div>
        </div>
        <button onClick={clearLast} className="text-faint hover:text-ink" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-3">
        <div className="space-y-2">
          <Logo />
          <p className="text-dim">Pay-on-proof jobs, settled in USDC on Arc. Built for the Arc Microgrants program.</p>
          <p className="text-xs text-faint">Prototype contracts, not independently audited. Keep amounts small.</p>
        </div>
        <div className="space-y-2">
          <div className="eyebrow">Contracts on Arc mainnet</div>
          <div className="flex flex-col gap-1.5">
            <span className="text-dim">
              Jobs (ERC-8183): <a className="mono link" href={explorer.address(CONTRACTS.jobs)} target="_blank" rel="noreferrer">{shortAddress(CONTRACTS.jobs)}</a>
            </span>
            <span className="text-dim">
              Panel (evaluator + hook): <a className="mono link" href={explorer.address(CONTRACTS.panel)} target="_blank" rel="noreferrer">{shortAddress(CONTRACTS.panel)}</a>
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="eyebrow">Open source</div>
          <a className="link block" href="https://github.com/pauleke65/accrue-arc" target="_blank" rel="noreferrer">github.com/pauleke65/accrue-arc</a>
          <Link className="link block" href="/agent.json">Proof Engine agent card (ERC-8004)</Link>
          <Link className="link block" href="/status">Deployment status</Link>
        </div>
      </div>
    </footer>
  );
}
