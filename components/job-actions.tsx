"use client";
import { useState } from "react";
import { CheckCircle2, Coins, Send, XCircle } from "lucide-react";
import { erc20Abi } from "viem";
import { useWallet } from "@/app/wallet";
import { CONTRACTS, USDC } from "@/lib/arc";
import { jobsAbi, panelAbi } from "@/lib/abi";
import { readableError } from "@/lib/errors";
import { formatUsdc, unixNow } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import type { JobDetail } from "@/lib/jobs";
import { encodeEvidence, evidenceProblem, evidenceSchema } from "@/lib/policy";
import { ConnectPanel } from "./shell";
import { AddressLink, Button, Field, Notice, Section, TxLink } from "./ui";

type CheckLine = { label: string; passed: boolean; detail: string };

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await task();
      onDone();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, setError };
}

export function JobActions({ job, engine, reload }: { job: JobDetail; engine: string | null; reload: () => void }) {
  const wallet = useWallet();
  const { busy, error, run } = useAction(reload);
  const me = wallet.address?.toLowerCase() ?? null;
  const now = useNow();
  const isClient = !!me && me === job.client.toLowerCase();
  const isProvider = !!me && !!job.provider && me === job.provider.toLowerCase();
  const isReviewer = !!me && !!job.panel?.reviewers.some((r) => r.toLowerCase() === me);
  const myVote = job.panel?.votes.find((v) => v.reviewer.toLowerCase() === me);
  const id = BigInt(job.id);

  const publicActions: React.ReactNode[] = [];
  if (job.governed && job.phase === "review_lapsed")
    publicActions.push(
      <Button key="settle" className="w-full" busy={busy === "settle"} disabled={!wallet.address} onClick={() => run("settle", () => wallet.write({ address: CONTRACTS.panel, abi: panelAbi, functionName: "settle", args: [id] }, "Payment released"))}>
        Release payment to the worker
      </Button>,
    );
  if (job.governed && job.phase === "overdue")
    publicActions.push(
      <Button key="undelivered" className="w-full" variant="secondary" busy={busy === "undelivered"} disabled={!wallet.address} onClick={() => run("undelivered", () => wallet.write({ address: CONTRACTS.panel, abi: panelAbi, functionName: "refundUndelivered", args: [id] }, "Client refunded"))}>
        Return the budget to the client
      </Button>,
    );
  if ((job.status === "Funded" || job.status === "Submitted") && now >= job.expiredAt)
    publicActions.push(
      <Button key="expire" className="w-full" variant="secondary" busy={busy === "expire"} disabled={!wallet.address} onClick={() => run("expire", () => wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "claimRefund", args: [id] }, "Expired job refunded"))}>
        Refund this expired job
      </Button>,
    );

  const settled = ["paid", "paid_on_silence", "refunded", "refunded_undelivered", "cancelled", "withdrawn", "expired"].includes(job.phase);
  if (settled) return null;

  return (
    <Section eyebrow="Your move" title="Actions">
      <div className="space-y-4">
        {!wallet.address && (
          <div className="space-y-3">
            <p className="text-sm text-dim">Sign in to act on this job.</p>
            <ConnectPanel />
          </div>
        )}

        {wallet.address && job.phase === "hiring" && !isClient && !isReviewer && <Apply job={job} reload={reload} />}
        {wallet.address && job.phase === "hiring" && isClient && <Assign job={job} reload={reload} />}
        {wallet.address && job.phase === "awaiting_funds" && isClient && (
          <Button className="w-full" busy={busy === "fund"} onClick={() => run("fund", async () => {
            await wallet.write({ address: USDC.address, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.jobs, BigInt(job.budget)] }, "USDC approved");
            await wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "fund", args: [id, BigInt(job.budget), "0x"] }, "Job funded");
          })}>
            Lock {formatUsdc(BigInt(job.budget))} USDC
          </Button>
        )}
        {wallet.address && (job.phase === "hiring" || job.phase === "awaiting_funds") && isClient && (
          <Button variant="ghost" size="sm" busy={busy === "withdraw"} onClick={() => run("withdraw", () => wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "reject", args: [id, "0x".padEnd(66, "0") as `0x${string}`, "0x"] }, "Job withdrawn"))}>
            Withdraw this job
          </Button>
        )}

        {wallet.address && job.phase === "in_progress" && isProvider && <Deliver job={job} reload={reload} />}
        {wallet.address && job.phase === "in_progress" && isClient && (
          <p className="text-sm text-dim">The worker is on it. You&apos;ll see the delivery here the moment it lands.</p>
        )}

        {wallet.address && job.phase === "in_review" && isReviewer && myVote?.choice === "none" && (
          me === engine?.toLowerCase() ? null : <Vote job={job} reload={reload} />
        )}
        {wallet.address && job.phase === "in_review" && isReviewer && myVote && myVote.choice !== "none" && (
          <Notice tone="paid">You voted {myVote.choice}. Waiting for the rest of the panel.</Notice>
        )}
        {wallet.address && job.phase === "in_review" && (isClient || isProvider) && !isReviewer && (
          <p className="text-sm text-dim">The panel is reviewing the delivery. If it stays silent past the window, the worker is paid.</p>
        )}

        {wallet.address && (isClient || isProvider) && (job.status === "Funded" || job.status === "Submitted") && job.governed && (
          <CancelConsent job={job} isClient={isClient} reload={reload} />
        )}

        {publicActions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-faint">Anyone may do this: the rule has already decided the outcome.</p>
            {publicActions}
          </div>
        )}

        {wallet.address && !isClient && !isProvider && !isReviewer && publicActions.length === 0 && job.phase !== "hiring" && (
          <p className="text-sm text-dim">You&apos;re not part of this job. Everything about it is public; watch it settle here.</p>
        )}
        {error && <p className="text-sm text-refund">{error}</p>}
      </div>
    </Section>
  );
}

function Apply({ job, reload }: { job: JobDetail; reload: () => void }) {
  const wallet = useWallet();
  const [pitch, setPitch] = useState("");
  const { busy, error, run } = useAction(reload);
  const applied = job.applications.some((a) => a.applicant.toLowerCase() === wallet.address?.toLowerCase());
  if (applied) return <Notice tone="paid">You&apos;ve applied. If the client picks you, the budget locks and the job is yours.</Notice>;
  return (
    <div className="space-y-3">
      <Field label="Apply for this job" hint="Your note is stored on chain with your application.">
        <textarea rows={3} maxLength={1000} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="Why you, and when you can deliver" />
      </Field>
      <Button className="w-full" busy={busy === "apply"} onClick={() => run("apply", () => wallet.write({ address: CONTRACTS.panel, abi: panelAbi, functionName: "applyToJob", args: [BigInt(job.id), pitch.trim()] }, "Application sent"))}>
        <Send className="size-4" /> Apply
      </Button>
      {wallet.balance === 0n && <p className="text-xs text-faint">Applying needs a few cents of USDC on Arc for the network fee.</p>}
      {error && <p className="text-sm text-refund">{error}</p>}
    </div>
  );
}

function Assign({ job, reload }: { job: JobDetail; reload: () => void }) {
  const wallet = useWallet();
  const { busy, error, run } = useAction(reload);
  const budget = BigInt(job.budget);
  const short = wallet.balance !== null && wallet.balance < budget;
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Applications ({job.applications.length})</div>
      {job.applications.length === 0 && <p className="text-sm text-dim">No one has applied yet. Share this page with people who can do the work.</p>}
      {job.applications.map((a) => (
        <div key={a.applicant} className="rounded-[10px] border border-line bg-page p-3">
          <AddressLink address={a.applicant} />
          {a.pitch && <p className="mt-1.5 text-sm text-dim">“{a.pitch}”</p>}
          <Button size="sm" className="mt-2.5" busy={busy === a.applicant} disabled={short} onClick={() => run(a.applicant, async () => {
            const deadline = BigInt(unixNow() + 1800);
            const { v, r, s } = await wallet.signPermit(CONTRACTS.jobs, budget, deadline);
            await wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "assignAndFundWithPermit", args: [BigInt(job.id), a.applicant, budget, "0x", "0x", deadline, v, r, s] }, "Worker assigned, budget locked");
          })}>
            Assign and lock {formatUsdc(budget)} USDC
          </Button>
        </div>
      ))}
      {short && <p className="text-xs text-refund">You need {formatUsdc(budget)} USDC on Arc to assign a worker.</p>}
      {error && <p className="text-sm text-refund">{error}</p>}
    </div>
  );
}

function Deliver({ job, reload }: { job: JobDetail; reload: () => void }) {
  const wallet = useWallet();
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CheckLine[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [sponsored, setSponsored] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction(reload);
  const check = job.brief?.check;
  const lowGas = wallet.balance !== null && wallet.balance < 20_000n;

  const preflight = async () => {
    setChecking(true);
    setError("");
    setLines(null);
    try {
      const res = await fetch("/api/preflight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, url, notes }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setLines(body.items);
      if (body.error) setError(body.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check could not run.");
    } finally {
      setChecking(false);
    }
  };

  const submit = () =>
    run("submit", async () => {
      const parsed = evidenceSchema.parse({ v: 1, url: url.trim(), notes: notes.trim() });
      const problem = check ? evidenceProblem(check, parsed.url) : null;
      if (problem) throw new Error(problem);
      const evidence = encodeEvidence(parsed);
      await wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "submit", args: [BigInt(job.id), evidence.deliverable, evidence.optParams] }, "Delivery submitted");
    });

  const coverFee = () =>
    run("sponsor", async () => {
      const res = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address, jobId: job.id }) });
      const body = await res.json();
      if (!body.tx) throw new Error(body.message ?? body.error ?? "Could not cover the fee.");
      setSponsored(body.tx);
      await wallet.refreshBalance();
    });

  return (
    <div className="space-y-3">
      <Field label="Link to your work" hint={check && check.kind === "github_pr" ? `A pull request on ${check.repo}` : "A public https:// link the panel can open"}>
        <input value={url} onChange={(e) => { setUrl(e.target.value); setLines(null); }} placeholder="https://" inputMode="url" />
      </Field>
      <Field label="Note for the panel (optional)">
        <textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {check && check.kind !== "manual" && (
        <Button variant="secondary" className="w-full" busy={checking} disabled={!url} onClick={preflight}>
          Run the Proof Engine&apos;s checks first
        </Button>
      )}
      {lines && (
        <ul className="space-y-1.5 rounded-[10px] border border-line bg-page p-3">
          {lines.map((line) => (
            <li key={line.label} className="flex items-start gap-2 text-sm">
              {line.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-paid" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-refund" />}
              <span>{line.label} <span className="text-dim">· {line.detail}</span></span>
            </li>
          ))}
        </ul>
      )}
      {lowGas && !sponsored && (
        <Button variant="secondary" className="w-full" busy={busy === "sponsor"} onClick={coverFee}>
          <Coins className="size-4" /> Cover my first network fee
        </Button>
      )}
      {sponsored && <p className="text-xs text-paid">First fee covered: <TxLink hash={sponsored} /></p>}
      <Button className="w-full" busy={busy === "submit"} disabled={!url} onClick={submit}>
        <Send className="size-4" /> Submit delivery
      </Button>
      <p className="text-xs text-faint">A failing verdict refunds the client and can&apos;t be redone, so run the checks before you submit.</p>
      {error && <p className="text-sm text-refund">{error}</p>}
    </div>
  );
}

function Vote({ job, reload }: { job: JobDetail; reload: () => void }) {
  const wallet = useWallet();
  const [note, setNote] = useState("");
  const [sponsored, setSponsored] = useState<string | null>(null);
  const { busy, error, run } = useAction(reload);
  const lowGas = wallet.balance !== null && wallet.balance < 20_000n;
  const coverFee = () =>
    run("sponsor", async () => {
      const res = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address, jobId: job.id }) });
      const body = await res.json();
      if (!body.tx) throw new Error(body.message ?? body.error ?? "Could not cover the fee.");
      setSponsored(body.tx);
      await wallet.refreshBalance();
    });
  const cast = (pass: boolean) =>
    run(pass ? "pass" : "fail", () =>
      wallet.write({ address: CONTRACTS.panel, abi: panelAbi, functionName: "vote", args: [BigInt(job.id), pass, note.trim() || (pass ? "Meets the brief." : "Does not meet the brief.")] }, pass ? "Pass vote recorded" : "Fail vote recorded"),
    );
  return (
    <div className="space-y-3">
      <Field label="Your verdict" hint="Your note is published on chain with your vote.">
        <textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, and what you found" />
      </Field>
      {lowGas && !sponsored && (
        <Button variant="secondary" className="w-full" busy={busy === "sponsor"} onClick={coverFee}>
          <Coins className="size-4" /> Cover my first network fee
        </Button>
      )}
      {sponsored && <p className="text-xs text-paid">First fee covered: <TxLink hash={sponsored} /></p>}
      <div className="grid grid-cols-2 gap-2">
        <Button busy={busy === "pass"} onClick={() => cast(true)}>
          <CheckCircle2 className="size-4" /> Pass
        </Button>
        <Button variant="danger" busy={busy === "fail"} onClick={() => cast(false)}>
          <XCircle className="size-4" /> Fail
        </Button>
      </div>
      {error && <p className="text-sm text-refund">{error}</p>}
    </div>
  );
}

function CancelConsent({ job, isClient, reload }: { job: JobDetail; isClient: boolean; reload: () => void }) {
  const wallet = useWallet();
  const { busy, error, run } = useAction(reload);
  const consent = job.panel?.cancelConsent ?? 0;
  const mine = isClient ? consent & 1 : consent & 2;
  const theirs = isClient ? consent & 2 : consent & 1;
  return (
    <div className="border-t border-line pt-3">
      {mine ? (
        <p className="text-xs text-dim">You agreed to call this job off. If the {isClient ? "worker" : "client"} agrees too, the budget returns to the client.</p>
      ) : (
        <>
          {theirs ? <p className="mb-2 text-xs text-wait">The {isClient ? "worker" : "client"} has asked to call this job off.</p> : null}
          <Button variant="ghost" size="sm" busy={busy === "cancel"} onClick={() => run("cancel", () => wallet.write({ address: CONTRACTS.panel, abi: panelAbi, functionName: "cancel", args: [BigInt(job.id)] }, "Cancellation agreed"))}>
            {theirs ? "Agree to call it off" : "Propose calling it off"}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-refund">{error}</p>}
    </div>
  );
}

