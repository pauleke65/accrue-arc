import { readRecentJobs, totals } from "@/lib/jobs";
import { setupState } from "@/lib/server/bootstrap";
import { cached, json, problem } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Math.min(200, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 100)));
  if (!(setupState.deployed.jobs && setupState.deployed.panel)) return json({ total: 0, jobs: [], totals: null, deployed: false });
  try {
    const data = await cached(`jobs:${limit}`, 2_500, async () => {
      const { total, jobs } = await readRecentJobs(limit);
      const sums = totals(jobs);
      return {
        total,
        jobs,
        totals: { ...sums, paid: sums.paid.toString(), escrowed: sums.escrowed.toString(), refunded: sums.refunded.toString() },
        deployed: true,
      };
    });
    return json(data);
  } catch (error) {
    return problem(502, error instanceof Error ? error.message : "Could not read Arc");
  }
}
