import { isSettled, readJobDetail } from "@/lib/jobs";
import { cached, json, problem } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isSafeInteger(jobId) || jobId < 1) return problem(400, "Job ids are positive whole numbers.");
  try {
    // A settled job never changes again, so it can be cached for longer.
    const job = await cached(`job:${jobId}`, 1_500, () => readJobDetail(jobId));
    if (!job) return problem(404, "There is no job with that id.");
    return json(job, { headers: isSettled(job.phase) ? { "cache-control": "public, max-age=30" } : {} });
  } catch (error) {
    return problem(502, error instanceof Error ? error.message : "Could not read Arc");
  }
}
