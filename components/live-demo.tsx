"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, Play, XCircle } from "lucide-react";
import { formatFee } from "@/lib/format";
import type { DemoRun, DemoStep } from "@/lib/server/demo";
import { Button, TxLink } from "./ui";

function StepIcon({ status }: { status: DemoStep["status"] }) {
  if (status === "done") return <CheckCircle2 className="size-5 text-paid" />;
  if (status === "running") return <Loader2 className="size-5 animate-spin text-accent" />;
  if (status === "failed") return <XCircle className="size-5 text-refund" />;
  return <Circle className="size-5 text-faint" />;
}

export function LiveDemo({ compact = false }: { compact?: boolean }) {
  const [run, setRun] = useState<DemoRun | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [available, setAvailable] = useState<{ ok: boolean; reason?: string } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/demo")
      .then((r) => r.json())
      .then(setAvailable)
      .catch(() => setAvailable({ ok: false, reason: "Could not reach the server." }));
  }, []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const res = await fetch(`/api/demo/${id}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as DemoRun;
          setRun(next);
          if (next.finishedAt) return;
        }
      } catch {
        // Keep polling through a blip.
      }
      timer.current = window.setTimeout(tick, 400);
    };
    void tick();
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The demo could not start.");
      setRun(body as DemoRun);
      poll((body as DemoRun).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The demo could not start.");
    } finally {
      setStarting(false);
    }
  };

  const running = !!run && !run.finishedAt;
  const onChainMs = run?.steps.reduce((sum, s) => sum + (s.tx && s.ms ? s.ms : 0), 0) ?? 0;
  const fees = run?.steps.reduce((sum, s) => sum + (s.fee ? BigInt(s.fee) : 0n), 0n) ?? 0n;
  const txCount = run?.steps.filter((s) => s.tx).length ?? 0;
  const succeeded = run?.finishedAt && !run.error;

  return (
    <div className="card overflow-hidden border-white/60 shadow-[0_24px_60px_-28px_rgb(27_49_88/0.45)]">
      <div className="border-b border-line p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-paid pulse" aria-hidden />
          <span className="eyebrow text-paid">Live on Arc mainnet</span>
        </div>
        <h3 className="mt-3 text-2xl">Watch a real job settle</h3>
        {!compact && (
          <p className="mt-1.5 text-sm text-dim">
            Two demo accounts run a 0.10 USDC job end to end: the client posts and locks the budget, the worker delivers a page, and the Proof Engine
            fetches it, checks it and votes. Every step is a real transaction you can open on the explorer.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={start} busy={starting} disabled={running || available?.ok === false} size="lg">
            <Play className="size-4" /> {run ? "Run another" : "Run a live job"}
          </Button>
          {available?.ok === false && !run && <span className="text-sm text-dim">{available.reason}</span>}
          {error && <span className="text-sm text-refund">{error}</span>}
        </div>
      </div>
      <ol className="divide-y divide-line">
        {(run?.steps ?? PLACEHOLDER).map((step, i) => (
          <li key={step.key} className="flex items-start gap-3 px-5 py-3.5 sm:px-6">
            <div className="pt-0.5">{run ? <StepIcon status={step.status} /> : <span className="num grid size-5 place-items-center rounded-full border border-line text-[0.7rem] text-faint">{i + 1}</span>}</div>
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${step.status === "pending" ? "text-dim" : ""}`}>{step.label}</div>
              {step.detail && <div className="mt-0.5 truncate text-xs text-faint">{step.detail}</div>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
              {step.ms !== undefined && step.status !== "pending" && (
                <span className="num text-sm text-ink">{(step.ms / 1000).toFixed(2)} s</span>
              )}
              {step.fee && <span className="num text-xs text-faint">{formatFee(BigInt(step.fee))} fee</span>}
              {step.tx && <TxLink hash={step.tx} />}
            </div>
          </li>
        ))}
      </ol>
      {run?.finishedAt && (
        <div className={`border-t px-5 py-4 text-sm sm:px-6 ${succeeded ? "border-paid/20 bg-paid-soft" : "border-refund/20 bg-refund-soft"}`}>
          {succeeded ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{txCount} transactions</strong>, each final in under a second: <span className="num">{(onChainMs / 1000).toFixed(2)} s</span> on chain in
                total, <span className="num">{formatFee(fees)}</span> in fees, all paid in USDC.
              </span>
              {run.jobId && (
                <Link href={`/jobs/${run.jobId}`} className="link font-medium">
                  Open job #{run.jobId} →
                </Link>
              )}
            </div>
          ) : (
            <span className="text-refund">{run.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

const PLACEHOLDER: DemoStep[] = [
  { key: "post", label: "Client posts the job and locks 0.10 USDC (one transaction, with a USDC permit)", status: "pending" },
  { key: "deliver", label: "Worker publishes a page and submits it as evidence", status: "pending" },
  { key: "check", label: "Proof Engine fetches the page and checks the agreed phrase", status: "pending" },
  { key: "pay", label: "Proof Engine votes on chain; the contract pays the worker", status: "pending" },
];
