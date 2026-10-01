"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bot, FileCheck2, GitPullRequest, Globe, ShieldCheck, UserCheck, Users } from "lucide-react";
import { decodeEventLog, getAddress, isAddress, type Address } from "viem";
import { useWallet } from "@/app/wallet";
import { ConnectPanel } from "@/components/shell";
import { Button, Field, Notice, Section, Usdc } from "@/components/ui";
import { CONTRACTS } from "@/lib/arc";
import { jobsAbi } from "@/lib/abi";
import { useStatus } from "@/lib/client";
import { readableError } from "@/lib/errors";
import { duration, formatUsdc, parseUsdc, unixNow } from "@/lib/format";
import { publicClient } from "@/lib/jobs";
import { briefSchema, encodeBrief, encodePanel, expiryFor, type Brief, type CheckKind } from "@/lib/policy";

const KINDS: { kind: CheckKind; title: string; body: string; icon: typeof Globe }[] = [
  { kind: "webpage", title: "Live web page", body: "A public page must show agreed text", icon: Globe },
  { kind: "github_pr", title: "Merged pull request", body: "Code merged into your repository", icon: GitPullRequest },
  { kind: "json_api", title: "API response", body: "An endpoint returns an agreed value", icon: FileCheck2 },
  { kind: "manual", title: "Reviewed by people", body: "Design, writing, anything a person judges", icon: Users },
];

type Preset = "engine" | "panel" | "client";

const PRESETS: { key: Preset; title: string; body: string; icon: typeof Bot; window: number }[] = [
  {
    key: "engine",
    title: "Proof Engine decides",
    body: "For machine-checkable work. The Proof Engine checks the facts and votes within seconds, and its vote decides.",
    icon: Bot,
    window: 6 * 3600,
  },
  {
    key: "panel",
    title: "Proof Engine + two reviewers",
    body: "Two of three must agree. The engine votes on the facts; the people you name decide when it isn't sure.",
    icon: ShieldCheck,
    window: 48 * 3600,
  },
  {
    key: "client",
    title: "I approve it myself",
    body: "You review the delivery. The worker sees, before starting, that silence past the window pays them.",
    icon: UserCheck,
    window: 72 * 3600,
  },
];

export default function PostPage() {
  const wallet = useWallet();
  const router = useRouter();
  const { data: status } = useStatus();
  const engine = (status?.wallets.engine?.address as Address | undefined) ?? null;

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [kind, setKind] = useState<CheckKind>("webpage");
  const [text, setText] = useState("");
  const [host, setHost] = useState("");
  const [repo, setRepo] = useState("");
  const [author, setAuthor] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [criteria, setCriteria] = useState("");
  const [budget, setBudget] = useState("5");
  const [hire, setHire] = useState<"open" | "named">("open");
  const [worker, setWorker] = useState("");
  const [preset, setPreset] = useState<Preset>("engine");
  const [reviewerA, setReviewerA] = useState("");
  const [reviewerB, setReviewerB] = useState("");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const effectivePreset: Preset = kind === "manual" && preset === "engine" ? "client" : preset;
  const reviewWindow = PRESETS.find((p) => p.key === effectivePreset)!.window;

  const draft = useMemo((): { brief?: Brief; problem?: string; amount?: bigint } => {
    const check =
      kind === "webpage"
        ? { kind, text: text.trim(), ...(host.trim() ? { host: host.trim().toLowerCase() } : {}) }
        : kind === "github_pr"
          ? { kind, repo: repo.trim(), ...(author.trim() ? { author: author.trim() } : {}) }
          : kind === "json_api"
            ? { kind, key: key.trim(), value, ...(host.trim() ? { host: host.trim().toLowerCase() } : {}) }
            : { kind, criteria: criteria.trim() };
    const parsed = briefSchema.safeParse({ v: 1, app: "accrue", title: title.trim(), brief: brief.trim(), check });
    let amount: bigint | undefined;
    try {
      amount = parseUsdc(budget);
    } catch (e) {
      return { problem: e instanceof Error ? e.message : "Check the budget." };
    }
    if (amount < 10_000n) return { problem: "The smallest budget is 0.01 USDC." };
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { problem: `${issue.path.join(" ") || "Brief"}: ${issue.message}`, amount };
    }
    return { brief: parsed.data, amount };
  }, [kind, text, host, repo, author, key, value, criteria, title, brief, budget]);

  const reviewers = (): Address[] => {
    if (effectivePreset === "client") return [wallet.address!];
    if (!engine) throw new Error("The Proof Engine isn't online yet.");
    if (effectivePreset === "engine") return [engine];
    for (const r of [reviewerA, reviewerB]) if (!isAddress(r.trim())) throw new Error("Enter both reviewers' Arc addresses.");
    return [engine, getAddress(reviewerA.trim()), getAddress(reviewerB.trim())];
  };

  const post = async () => {
    setBusy(true);
    setError("");
    try {
      if (!draft.brief || draft.amount === undefined) throw new Error(draft.problem ?? "Complete the brief.");
      const named = hire === "named";
      if (named && !isAddress(worker.trim())) throw new Error("Enter the worker's Arc address, or open the job to applicants.");
      const provider = named ? getAddress(worker.trim()) : ("0x0000000000000000000000000000000000000000" as Address);
      const panelReviewers = reviewers();
      const now = unixNow();
      const deliverBy = now + days * 86400;
      const job = {
        provider,
        evaluator: CONTRACTS.panel,
        expiredAt: BigInt(expiryFor(deliverBy, reviewWindow)),
        description: encodeBrief(draft.brief),
        hook: CONTRACTS.panel,
        budget: draft.amount,
        budgetParams: encodePanel({ reviewers: panelReviewers, threshold: panelReviewers.length === 3 ? 2 : 1, reviewWindow, deliverBy }),
        fundParams: "0x" as const,
      };
      let hash: `0x${string}`;
      if (named) {
        if (wallet.balance !== null && wallet.balance < draft.amount) throw new Error(`You need ${formatUsdc(draft.amount)} USDC on Arc to fund this job.`);
        const deadline = BigInt(now + 1800);
        const { v, r, s } = await wallet.signPermit(CONTRACTS.jobs, draft.amount, deadline);
        ({ hash } = await wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "createAndFundWithPermit", args: [job, deadline, v, r, s] }, "Job posted and funded"));
      } else {
        ({ hash } = await wallet.write({ address: CONTRACTS.jobs, abi: jobsAbi, functionName: "createWithBudget", args: [job] }, "Job posted"));
      }
      const receipt = await publicClient.getTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({ abi: jobsAbi, data: log.data, topics: log.topics });
          if (event.eventName === "JobCreated") return router.push(`/jobs/${event.args.jobId}`);
        } catch {
          // Not a kernel event.
        }
      }
      router.push("/jobs");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="eyebrow brace">New job</div>
        <h1 className="mt-4 text-4xl sm:text-5xl">Post an objective, lock the budget</h1>
        <p className="mt-2 text-dim">Say what done looks like. The brief is stored on chain with the job, and nobody can change it once it&apos;s funded.</p>
      </div>

      <Section eyebrow="//Step.01" title="The work">
        <div className="space-y-4">
          <Field label="Title">
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Add a pricing page to our site" />
          </Field>
          <Field label="Brief" hint="What you need, in plain words. Reviewers and the Proof Engine judge against this.">
            <textarea rows={4} maxLength={1500} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A pricing page with our three plans, linked from the main navigation…" />
          </Field>
        </div>
      </Section>

      <Section eyebrow="//Step.02" title="Definition of done">
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map(({ kind: k, title: t, body, icon: Icon }) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-[6px] border p-3.5 text-left transition-colors ${kind === k ? "border-accent/60 bg-accent-soft" : "border-line hover:border-line-strong"}`}>
              <div className="flex items-center gap-2 font-medium"><Icon className="size-4 text-accent" /> {t}</div>
              <div className="mt-1 text-xs text-dim">{body}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {kind === "webpage" && (
            <>
              <Field label="Text the page must show"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Plans start at $9" /></Field>
              <Field label="On this site (optional)" hint="So any page with the text won't do."><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" /></Field>
            </>
          )}
          {kind === "github_pr" && (
            <>
              <Field label="Repository it must merge into"><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="acme/website" /></Field>
              <Field label="Opened by (optional)" hint="The worker's GitHub username."><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="octocat" /></Field>
            </>
          )}
          {kind === "json_api" && (
            <>
              <Field label="JSON key"><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="status" /></Field>
              <Field label="Expected value"><input value={value} onChange={(e) => setValue(e.target.value)} placeholder="ok" /></Field>
              <Field label="On this host (optional)"><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="api.example.com" /></Field>
            </>
          )}
          {kind === "manual" && (
            <div className="sm:col-span-2">
              <Field label="What the reviewers will look for" hint="No automatic check: people decide, and the Proof Engine abstains.">
                <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="Three logo concepts as PNG and SVG, each on light and dark backgrounds" />
              </Field>
            </div>
          )}
        </div>
      </Section>

      <Section eyebrow="//Step.03" title="Budget, worker and panel">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget (USDC)" hint="Paid in full on a passing verdict, refunded in full otherwise.">
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="num" />
          </Field>
          <Field label="Time to deliver">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">Who does the work</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setHire("open")} className={`rounded-[6px] border p-3 text-left text-sm ${hire === "open" ? "border-accent/60 bg-accent-soft" : "border-line"}`}>
              <div className="font-medium">Open to applicants</div>
              <div className="mt-0.5 text-xs text-dim">The budget locks when you pick someone</div>
            </button>
            <button type="button" onClick={() => setHire("named")} className={`rounded-[6px] border p-3 text-left text-sm ${hire === "named" ? "border-accent/60 bg-accent-soft" : "border-line"}`}>
              <div className="font-medium">Someone I know</div>
              <div className="mt-0.5 text-xs text-dim">Post and lock the budget now, in one step</div>
            </button>
          </div>
          {hire === "named" && (
            <div className="mt-3">
              <Field label="Worker's Arc address"><input value={worker} onChange={(e) => setWorker(e.target.value)} placeholder="0x…" className="mono" /></Field>
            </div>
          )}
        </div>
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">Who decides it&apos;s done</div>
          <div className="space-y-2">
            {PRESETS.map(({ key: k, title: t, body, icon: Icon }) => {
              const disabled = (k !== "client" && !engine) || (k === "engine" && kind === "manual");
              return (
                <button key={k} type="button" disabled={disabled} onClick={() => setPreset(k)} className={`flex w-full items-start gap-3 rounded-[6px] border p-3.5 text-left transition-colors disabled:opacity-40 ${effectivePreset === k ? "border-accent/60 bg-accent-soft" : "border-line hover:border-line-strong"}`}>
                  <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
                  <div>
                    <div className="text-sm font-medium">{t}</div>
                    <div className="mt-0.5 text-xs text-dim">{body}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {effectivePreset === "panel" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Reviewer 1 (Arc address)"><input value={reviewerA} onChange={(e) => setReviewerA(e.target.value)} placeholder="0x…" className="mono" /></Field>
              <Field label="Reviewer 2 (Arc address)"><input value={reviewerB} onChange={(e) => setReviewerB(e.target.value)} placeholder="0x…" className="mono" /></Field>
            </div>
          )}
          <p className="mt-3 text-xs text-faint">
            Review window: {duration(reviewWindow)} after delivery. If the panel hasn&apos;t decided by then, the worker is paid.
          </p>
        </div>
      </Section>

      <Section title="Post it">
        {!wallet.address ? (
          <ConnectPanel />
        ) : (
          <div className="space-y-3">
            {draft.amount !== undefined && (
              <div className="flex items-center justify-between rounded-[6px] border border-line bg-raised px-4 py-3 text-sm">
                <span className="text-dim">{hire === "named" ? "You lock now" : "You lock when you assign"}</span>
                <Usdc value={draft.amount} className="text-lg font-semibold" />
              </div>
            )}
            {draft.problem && <Notice tone="wait">{draft.problem}</Notice>}
            <Button size="lg" className="w-full" busy={busy} disabled={!!draft.problem} onClick={post}>
              {hire === "named" ? "Post and lock the budget" : "Post the job"}
            </Button>
            <p className="text-xs text-faint">
              {hire === "named" ? "One signature approves the USDC and one transaction posts and funds the job." : "Posting only records the job; no USDC moves until you assign a worker."} The network fee is a fraction of a cent, paid in USDC.
            </p>
            {error && <p className="text-sm text-refund">{error}</p>}
          </div>
        )}
      </Section>
    </div>
  );
}
