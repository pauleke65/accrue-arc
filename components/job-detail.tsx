"use client";
import { Bot, CheckCircle2, CircleDashed, ExternalLink, XCircle } from "lucide-react";
import { dateTime, duration, relative } from "@/lib/format";
import type { JobDetail, VoteView } from "@/lib/jobs";
import { CHECK_LABELS, describeCheck } from "@/lib/policy";
import { CHECK_ICONS } from "./job-card";
import { AddressLink, Badge, Notice, Section, TxLink, Usdc } from "./ui";

export type People = { engine: string | null; agentId: string | null; me: string | null };

export function who(address: string, job: JobDetail, people: People): string {
  const a = address.toLowerCase();
  if (people.engine && a === people.engine.toLowerCase()) return "Proof Engine";
  if (a === job.client.toLowerCase()) return "Client";
  if (job.provider && a === job.provider.toLowerCase()) return "Worker";
  return "Reviewer";
}

/** One plain sentence: where the job stands and whose move it is. */
export function StatusLine({ job, now }: { job: JobDetail; now: number }) {
  const p = job.panel;
  const quorum = p ? `${p.threshold} of ${p.reviewers.length}` : "";
  switch (job.phase) {
    case "hiring":
      return <Notice>Open for applications. The client picks a worker, and assigning them locks the budget in escrow.</Notice>;
    case "awaiting_funds":
      return <Notice>The worker is named. Waiting for the client to lock the budget.</Notice>;
    case "in_progress":
      return (
        <Notice>
          Funded. The worker has until <strong>{dateTime(p!.deliverBy)}</strong> ({relative(p!.deliverBy, now)}) to deliver.
        </Notice>
      );
    case "overdue":
      return <Notice tone="refund">Nothing was delivered by the deadline. Anyone can now return the budget to the client.</Notice>;
    case "in_review":
      return (
        <Notice tone="wait">
          Delivered {relative(p!.deliveredAt, now)}. The panel ({quorum} must agree) has until <strong>{dateTime(p!.reviewEndsAt)}</strong>; if it
          stays silent, the worker is paid.
        </Notice>
      );
    case "review_lapsed":
      return <Notice tone="wait">The review window ended without a decision. Silence pays: anyone can release the payment now.</Notice>;
    case "paid":
      return <Notice tone="paid">Paid to the worker {relative(job.timeline.closedAt, now)}, on the panel&apos;s verdict.</Notice>;
    case "paid_on_silence":
      return <Notice tone="paid">Paid to the worker {relative(job.timeline.closedAt, now)}: the panel let the review window pass.</Notice>;
    case "refunded":
      return <Notice tone="refund">Refunded to the client {relative(job.timeline.closedAt, now)}: the panel found the work did not meet the brief.</Notice>;
    case "refunded_undelivered":
      return <Notice tone="refund">Refunded to the client: nothing was delivered by the deadline.</Notice>;
    case "cancelled":
      return <Notice>Called off by client and worker together; the budget went back to the client.</Notice>;
    case "withdrawn":
      return <Notice>The client withdrew this job before it was funded.</Notice>;
    case "expired":
      return <Notice>The job expired undecided and its budget went back to the client.</Notice>;
  }
}

export function BriefSection({ job }: { job: JobDetail }) {
  if (!job.brief)
    return (
      <Section title="Description">
        <p className="whitespace-pre-wrap break-words text-sm text-dim">{job.description || "No description."}</p>
        <p className="mt-3 text-xs text-faint">This ERC-8183 job was not posted through Accrue, so it has no machine-checkable brief.</p>
      </Section>
    );
  const Icon = CHECK_ICONS[job.brief.check.kind];
  return (
    <Section eyebrow="The brief" title="What the client asked for">
      <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-dim">{job.brief.brief}</p>
      <div className="mt-5 rounded-[12px] border border-line bg-raised p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-accent" /> Definition of done · {CHECK_LABELS[job.brief.check.kind]}
        </div>
        <p className="mt-1.5 text-sm text-ink">{describeCheck(job.brief.check)}</p>
        {job.brief.check.kind !== "manual" && (
          <p className="mt-2 text-xs text-faint">The Proof Engine checks this fact itself before it votes. The brief is stored on chain with the job.</p>
        )}
      </div>
    </Section>
  );
}

export function EvidenceSection({ job }: { job: JobDetail }) {
  if (!job.evidence) return null;
  const parsed = job.evidence.parsed;
  return (
    <Section eyebrow="Delivered" title="Evidence" action={job.evidence.tx ? <TxLink hash={job.evidence.tx}>on chain</TxLink> : undefined}>
      {parsed ? (
        <div className="space-y-2">
          <a href={parsed.url} target="_blank" rel="noreferrer nofollow" className="link inline-flex items-center gap-1.5 break-all">
            {parsed.url} <ExternalLink className="size-3.5 shrink-0" />
          </a>
          {parsed.notes && <p className="text-sm text-dim">“{parsed.notes}”</p>}
        </div>
      ) : (
        <pre className="mono overflow-x-auto text-xs text-dim">{job.evidence.json}</pre>
      )}
      <p className="mt-3 text-xs text-faint">
        Submitted hash <span className="mono">{job.timeline.deliverable.slice(0, 18)}…</span>, which the panel contract checked matches this evidence.
      </p>
    </Section>
  );
}

type Report = {
  verdict?: string;
  reason?: string;
  items?: { label: string; passed: boolean; detail: string }[];
  ai?: { model: string; requirementsMet: number; needsHumanReview: number } | null;
  agent?: string | null;
};

function parseReport(report?: string): Report | null {
  if (!report) return null;
  try {
    const parsed = JSON.parse(report) as Report;
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function VoteRow({ vote, job, people }: { vote: VoteView; job: JobDetail; people: People }) {
  const role = who(vote.reviewer, job, people);
  const report = parseReport(vote.report);
  const isEngine = role === "Proof Engine";
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isEngine ? <Bot className="size-4 text-accent" /> : null}
          <span className="font-medium">{role}</span>
          {isEngine && people.agentId && <Badge tone="accent">ERC-8004 #{people.agentId}</Badge>}
          <AddressLink address={vote.reviewer} you={!!people.me && people.me.toLowerCase() === vote.reviewer.toLowerCase()} />
        </div>
        <div className="flex items-center gap-2">
          {vote.choice === "pass" && <Badge tone="paid">Pass</Badge>}
          {vote.choice === "fail" && <Badge tone="refund">Fail</Badge>}
          {vote.choice === "none" && <Badge>No vote</Badge>}
          {vote.tx && <TxLink hash={vote.tx} />}
        </div>
      </div>
      {report?.items && report.items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {report.items.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-sm">
              {item.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-paid" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-refund" />}
              <span>
                <span className="text-ink">{item.label}</span> <span className="text-dim">· {item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {report?.ai && (
        <p className="mt-2 text-xs text-faint">
          Model {report.ai.model}: requirements met {Math.round(report.ai.requirementsMet * 100)}%, needs a person {Math.round(report.ai.needsHumanReview * 100)}%.
        </p>
      )}
      {report?.reason && <p className="mt-2 text-sm text-dim">{report.reason}</p>}
      {!report && vote.report && <p className="mt-2 text-sm text-dim">“{vote.report}”</p>}
    </li>
  );
}

export function VotesSection({ job, people }: { job: JobDetail; people: People }) {
  if (!job.panel || job.timeline.submittedAt === 0) return null;
  const voted = job.panel.votes.filter((v) => v.choice !== "none");
  return (
    <Section
      eyebrow="The panel's verdict"
      title={`${job.panel.passes} pass · ${job.panel.fails} fail`}
      action={<span className="text-sm text-dim">{job.panel.threshold} of {job.panel.reviewers.length} decide</span>}
    >
      {voted.length === 0 ? (
        <p className="text-sm text-dim">No votes yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {voted.map((vote) => (
            <VoteRow key={vote.reviewer} vote={vote} job={job} people={people} />
          ))}
        </ul>
      )}
    </Section>
  );
}

export function PartiesSection({ job, people }: { job: JobDetail; people: People }) {
  const me = people.me?.toLowerCase();
  return (
    <Section eyebrow="Who" title="Parties">
      <dl className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-dim">Client</dt>
          <dd><AddressLink address={job.client} you={me === job.client.toLowerCase()} /></dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-dim">Worker</dt>
          <dd>{job.provider ? <AddressLink address={job.provider} you={me === job.provider.toLowerCase()} /> : <span className="text-faint">Not chosen yet</span>}</dd>
        </div>
        {job.panel?.reviewers.map((r) => (
          <div key={r} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-dim">
              {who(r, job, people) === "Proof Engine" ? <><Bot className="size-3.5 text-accent" /> Proof Engine</> : `Reviewer${who(r, job, people) === "Client" ? " (client)" : ""}`}
            </dt>
            <dd><AddressLink address={r} you={me === r.toLowerCase()} /></dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function TermsSection({ job }: { job: JobDetail }) {
  const p = job.panel;
  return (
    <Section eyebrow="Terms" title="On-chain rules">
      <dl className="space-y-2.5 text-sm">
        <Row label="Budget"><Usdc value={job.budget} decimals={6} /></Row>
        {p && <Row label="Quorum">{p.threshold} of {p.reviewers.length} reviewers</Row>}
        {p && <Row label="Deliver by">{dateTime(p.deliverBy)}</Row>}
        {p && <Row label="Review window">{duration(p.reviewWindow)}, then silence pays</Row>}
        <Row label="Expires">{dateTime(job.expiredAt)}</Row>
        <Row label="Evaluator">{job.governed ? "AccruePanel" : <span className="mono">{job.evaluator.slice(0, 10)}…</span>}</Row>
      </dl>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-dim">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function TimelineSection({ job }: { job: JobDetail }) {
  const t = job.timeline;
  const closedLabel =
    job.status === "Completed" ? "Paid" : job.status === "Expired" ? "Expired" : job.status === "Rejected" ? (t.fundedAt ? "Refunded" : "Withdrawn") : "Closed";
  const rows = [
    { label: "Posted", at: t.createdAt, tx: job.txs.created },
    { label: "Funded", at: t.fundedAt, tx: job.txs.funded },
    { label: "Delivered", at: t.submittedAt, tx: job.txs.submitted },
    { label: closedLabel, at: t.closedAt, tx: job.txs.closed },
  ];
  return (
    <Section eyebrow="History" title="Timeline">
      <ol className="space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              {row.at ? <CheckCircle2 className="size-4 text-paid" /> : <CircleDashed className="size-4 text-faint" />}
              <span className={row.at ? "" : "text-faint"}>{row.label}</span>
            </span>
            <span className="flex items-center gap-3 text-xs text-dim">
              {row.at > 0 && <span>{dateTime(row.at)}</span>}
              {row.tx && <TxLink hash={row.tx} />}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
