import { z } from "zod";
import { json, problem, rateLimited } from "@/lib/server/http";
import { sponsor } from "@/lib/server/sponsor";

export const dynamic = "force-dynamic";

const body = z.object({ address: z.string(), jobId: z.number().int().positive() });

export async function POST(request: Request) {
  if (rateLimited(request, "sponsor", 4)) return problem(429, "Too many requests.");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return problem(400, "Send an address and a job id.");
  try {
    const result = await sponsor(parsed.data.address, parsed.data.jobId);
    return json(result, { status: result.tx ? 200 : 409 });
  } catch (error) {
    return problem(502, error instanceof Error ? error.message : "Could not send the fee.");
  }
}
