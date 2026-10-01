import { demoAvailability, startDemo } from "@/lib/server/demo";
import { json, problem, publicBaseUrl, rateLimited } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(demoAvailability());
}

/** Starts a real job on Arc mainnet between the two demo wallets. */
export async function POST(request: Request) {
  if (rateLimited(request, "demo", 3)) return problem(429, "Give the last demo a moment to finish.");
  try {
    const run = await startDemo(publicBaseUrl(request));
    return json(run, { status: 202 });
  } catch (error) {
    return problem(409, error instanceof Error ? error.message : "The demo could not start.");
  }
}
