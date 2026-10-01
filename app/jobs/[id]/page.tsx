"use client";
import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { useWallet } from "@/app/wallet";
import { JobActions } from "@/components/job-actions";
import {
  BriefSection,
  EvidenceSection,
  PartiesSection,
  StatusLine,
  TermsSection,
  TimelineSection,
  VotesSection,
} from "@/components/job-detail";
import { PhaseBadge, Usdc } from "@/components/ui";
import { useJob, useStatus } from "@/lib/client";
import { isSettled } from "@/lib/jobs";
import { useNow } from "@/lib/use-now";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const jobId = Number(id);
  const { data: job, error, reload } = useJob(jobId);
  const { data: status } = useStatus();
  const wallet = useWallet();
  const people = {
    engine: status?.wallets.engine?.address ?? null,
    agentId: status?.erc8004.agentId ?? null,
    me: wallet.address,
  };
  const now = useNow();

  if (error && !job)
    return (
      <div className="card p-8 text-center">
        <p className="text-dim">{error}</p>
        <Link href="/jobs" className="link mt-3 inline-block text-sm">Back to jobs</Link>
      </div>
    );
  if (!job) return <div className="card p-8 text-center text-dim">Reading job #{jobId} from Arc…</div>;

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-ink">
        <ArrowLeft className="size-4" /> All jobs
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="num text-sm text-faint">Job #{job.id}</span>
            <PhaseBadge phase={job.phase} />
            {!isSettled(job.phase) && <span className="text-xs text-faint">updates live</span>}
          </div>
          <h1 className="mt-3 text-3xl sm:text-[2.6rem]">{job.brief?.title ?? `ERC-8183 job #${job.id}`}</h1>
        </div>
        <div className="text-right">
          <div className="eyebrow">Budget</div>
          <Usdc value={job.budget} className="font-[family-name:var(--font-display)] text-4xl font-light" />
        </div>
      </div>
      <StatusLine job={job} now={now} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <BriefSection job={job} />
          <EvidenceSection job={job} />
          <VotesSection job={job} people={people} />
        </div>
        <div className="space-y-6">
          <JobActions job={job} engine={people.engine} reload={reload} />
          <PartiesSection job={job} people={people} />
          <TermsSection job={job} />
          <TimelineSection job={job} />
        </div>
      </div>
    </div>
  );
}
