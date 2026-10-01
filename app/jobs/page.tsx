"use client";
import { useMemo, useState } from "react";
import { JobCard } from "@/components/job-card";
import { ButtonLink } from "@/components/ui";
import { useJobs, useStatus } from "@/lib/client";
import type { Phase } from "@/lib/jobs";
import { NETWORK_NAME } from "@/lib/arc";

const FILTERS: { key: string; label: string; phases: Phase[] | null }[] = [
  { key: "all", label: "All", phases: null },
  { key: "hiring", label: "Hiring", phases: ["hiring", "awaiting_funds"] },
  { key: "progress", label: "In progress", phases: ["in_progress", "overdue"] },
  { key: "review", label: "In review", phases: ["in_review", "review_lapsed"] },
  { key: "paid", label: "Paid", phases: ["paid", "paid_on_silence"] },
  { key: "refunded", label: "Refunded", phases: ["refunded", "refunded_undelivered", "cancelled", "withdrawn", "expired"] },
];

export default function JobsPage() {
  const { data, error } = useJobs();
  const { data: status } = useStatus();
  const [filter, setFilter] = useState("all");
  const engine = status?.wallets.engine?.address ?? null;

  const jobs = useMemo(() => {
    const phases = FILTERS.find((f) => f.key === filter)?.phases;
    return (data?.jobs ?? []).filter((job) => !phases || phases.includes(job.phase));
  }, [data, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow brace">Read live from Arc</div>
          <h1 className="mt-4 text-4xl sm:text-5xl">Jobs</h1>
          <p className="mt-1 text-dim">Every Accrue job on {NETWORK_NAME}, newest first. {data ? `${data.total} in total.` : ""}</p>
        </div>
        <ButtonLink href="/post">Post a job</ButtonLink>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`eyebrow rounded-[4px] border px-3 py-1.5 !text-[0.68rem] transition-colors ${
              filter === f.key ? "border-accent bg-accent !text-white" : "border-accent/60 !text-accent hover:bg-accent-soft"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-refund">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} engine={engine} />
        ))}
      </div>
      {data && jobs.length === 0 && (
        <div className="card p-8 text-center text-dim">
          {data.deployed ? "No jobs match this filter yet." : `The contracts are being deployed to ${NETWORK_NAME}.`}
        </div>
      )}
      {!data && !error && <div className="card p-8 text-center text-dim">Reading jobs from Arc…</div>}
    </div>
  );
}
