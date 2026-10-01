"use client";
import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { explorer } from "@/lib/arc";
import { formatUsdc, shortAddress, shortHash } from "@/lib/format";
import { PHASE_LABEL, type Phase } from "@/lib/jobs";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", busy, size = "md", className = "", children, disabled, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[6px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-[0.95rem]", lg: "h-12 px-6 text-base" };
  const variants = {
    primary: "bg-black text-white hover:bg-ink",
    secondary: "bg-white/70 text-ink border border-ink/80 hover:bg-white",
    ghost: "text-dim hover:text-ink hover:bg-raised",
    danger: "bg-refund-soft text-refund border border-refund/30 hover:bg-refund/20",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ href, children, variant = "primary", size = "md", className = "" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; size?: "md" | "lg"; className?: string }) {
  const sizes = { md: "h-10 px-4 text-[0.95rem]", lg: "h-12 px-6 text-base" };
  const variants = {
    primary: "bg-black text-white hover:bg-ink",
    secondary: "bg-white/70 text-ink border border-ink/80 hover:bg-white",
    ghost: "text-dim hover:text-ink hover:bg-raised",
  };
  return (
    <Link href={href} className={`inline-flex items-center justify-center gap-2 rounded-[6px] font-medium transition-colors ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

const PHASE_TONE: Record<Phase, "accent" | "wait" | "paid" | "refund" | "muted"> = {
  hiring: "accent",
  awaiting_funds: "muted",
  in_progress: "accent",
  overdue: "refund",
  in_review: "wait",
  review_lapsed: "wait",
  paid: "paid",
  paid_on_silence: "paid",
  refunded: "refund",
  refunded_undelivered: "refund",
  cancelled: "muted",
  withdrawn: "muted",
  expired: "muted",
};

const TONES = {
  accent: "bg-accent-soft text-accent border-accent/25",
  wait: "bg-wait-soft text-wait border-wait/25",
  paid: "bg-paid-soft text-paid border-paid/25",
  refund: "bg-refund-soft text-refund border-refund/25",
  muted: "bg-raised text-dim border-line",
};

export function Badge({ tone = "muted", children, dot }: { tone?: keyof typeof TONES; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current pulse" aria-hidden />}
      {children}
    </span>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  const live = ["hiring", "in_progress", "in_review", "review_lapsed"].includes(phase);
  return (
    <Badge tone={PHASE_TONE[phase]} dot={live}>
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

export function Usdc({ value, className = "", decimals = 2 }: { value: bigint | string; className?: string; decimals?: number }) {
  return (
    <span className={`num ${className}`}>
      {formatUsdc(typeof value === "string" ? BigInt(value) : value, decimals)}
      <span className="ml-1 text-[0.8em] text-dim">USDC</span>
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard refused; nothing else to do.
        }
      }}
      className="text-faint hover:text-ink transition-colors"
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="size-3.5 text-paid" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AddressLink({ address, label, you }: { address: string; label?: string; you?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={explorer.address(address)} target="_blank" rel="noreferrer" className="mono text-sm link" title={address}>
        {label ?? shortAddress(address)}
      </a>
      {you && <span className="text-xs text-paid">you</span>}
      <CopyButton text={address} label="Copy address" />
    </span>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a href={explorer.tx(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mono text-xs link" title={hash}>
      {children ?? shortHash(hash)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function Section({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-5 sm:p-7">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
          <h2 className="text-2xl">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="ticks px-5 py-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-2 font-[family-name:var(--font-display)] text-3xl font-light tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = "accent", children }: { tone?: "accent" | "wait" | "paid" | "refund"; children: ReactNode }) {
  return <div className={`rounded-[6px] border px-3.5 py-2.5 text-sm ${TONES[tone]}`}>{children}</div>;
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-faint">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-refund">{error}</span>}
    </label>
  );
}
