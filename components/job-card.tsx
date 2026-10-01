import Link from "next/link";
import { Bot, FileCheck2, GitPullRequest, Globe, Users } from "lucide-react";
import { relative, shortAddress } from "@/lib/format";
import type { JobView } from "@/lib/jobs";
import { CHECK_LABELS, describeCheck, type CheckKind } from "@/lib/policy";
import { PhaseBadge, Usdc } from "./ui";

export const CHECK_ICONS: Record<CheckKind, typeof Globe> = {
  webpage: Globe,
  github_pr: GitPullRequest,
  json_api: FileCheck2,
  manual: Users,
};

export function panelSummary(job: JobView, engine?: string | null): string {
  if (!job.panel) return "No panel";
  const n = job.panel.reviewers.length;
  const hasEngine = !!engine && job.panel.reviewers.some((r) => r.toLowerCase() === engine.toLowerCase());
  const clientOnly = n === 1 && job.panel.reviewers[0].toLowerCase() === job.client.toLowerCase();
  if (clientOnly) return "Client approves";
  if (n === 1 && hasEngine) return "Proof Engine decides";
  return `${job.panel.threshold} of ${n} must agree${hasEngine ? " · Proof Engine on panel" : ""}`;
}

export function JobCard({ job, engine }: { job: JobView; engine?: string | null }) {
  const kind = job.brief?.check.kind;
  const Icon = kind ? CHECK_ICONS[kind] : Bot;
  const when = job.timeline.closedAt || job.timeline.submittedAt || job.timeline.fundedAt || job.timeline.createdAt;
  return (
    <Link href={`/jobs/${job.id}`} className="card group block min-w-0 p-4 transition-[border-color,box-shadow] hover:border-ink/30 hover:shadow-[0_12px_32px_-20px_rgb(27_49_88/0.5)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[6px] bg-accent-soft text-accent">
            <Icon className="size-4.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium group-hover:underline">{job.brief?.title ?? `ERC-8183 job #${job.id}`}</div>
            <div className="mt-0.5 line-clamp-1 text-sm text-dim">{job.brief ? describeCheck(job.brief.check) : job.description.slice(0, 120)}</div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Usdc value={job.budget} className="font-medium" />
          <div className="mt-1">
            <PhaseBadge phase={job.phase} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        <span>#{job.id}</span>
        {kind && <span>{CHECK_LABELS[kind]}</span>}
        <span>{panelSummary(job, engine)}</span>
        <span>Client {shortAddress(job.client)}</span>
        {when > 0 && <span>{relative(when)}</span>}
      </div>
    </Link>
  );
}
