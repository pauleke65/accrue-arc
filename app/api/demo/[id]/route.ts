import { getRun } from "@/lib/server/demo";
import { json, problem } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = getRun(id);
  return run ? json(run) : problem(404, "That demo run is not on this server.");
}
