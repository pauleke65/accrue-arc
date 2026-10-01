import { z } from "zod";
import { readJobs } from "@/lib/jobs";
import { evidenceSchema } from "@/lib/policy";
import { runChecks } from "@/lib/server/checks";
import { json, problem, rateLimited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const body = z.object({ jobId: z.number().int().positive(), url: z.string(), notes: z.string().max(1000).default("") });

/**
 * Runs the job's checks against a link before the worker submits it, so a
 * delivery that would fail is caught while it can still be fixed. Facts only:
 * no vote, and no model call.
 */
export async function POST(request: Request) {
  if (rateLimited(request, "preflight", 12)) return problem(429, "Too many checks. Wait a moment and try again.");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "Send a job id and a link.");
  const evidence = evidenceSchema.safeParse({ v: 1, url: parsed.data.url, notes: parsed.data.notes });
  if (!evidence.success) return problem(400, evidence.error.issues[0]?.message ?? "That link cannot be checked.");
  const [job] = await readJobs([parsed.data.jobId]);
  if (!job?.brief) return problem(404, "That job has no Accrue brief to check against.");
  const report = await runChecks(job.brief.check, evidence.data, job.timeline.createdAt);
  return json({
    items: report.items,
    error: report.error,
    passed: !report.error && report.items.length > 0 && report.items.every((item) => item.passed),
    manual: job.brief.check.kind === "manual",
  });
}
