/** JSON that survives bigint values. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, (_, value) => (typeof value === "bigint" ? value.toString() : value)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

export function problem(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** The app's public origin, for links that leave the server (demo proofs, agent card). */
export function publicBaseUrl(request: Request): string {
  const configured = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** A small token bucket per client IP and route. */
export function rateLimited(request: Request, route: string, perMinute: number): boolean {
  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${route}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, at: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.at) / 60_000) * perMinute);
  bucket.at = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return true;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 5_000) buckets.clear();
  return false;
}

/** A tiny time-based cache for chain reads shared by every visitor. */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2_000) cache.clear();
  return value;
}
