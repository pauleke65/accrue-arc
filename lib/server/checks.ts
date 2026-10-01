import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Check, Evidence } from "../policy";
import { evidenceProblem, publicHttpsUrl } from "../policy";

/**
 * The Proof Engine's facts: what can be checked without judgement. A page
 * loads and shows the agreed text; a pull request is merged into the agreed
 * repository; an endpoint returns the agreed value. Each check yields
 * pass/fail lines for the report, plus an excerpt of what was seen so a model
 * (when configured) can judge the evidence against the brief.
 *
 * A check that cannot run (timeout, 5xx, rate limit) is not a failure: it sets
 * `error`, and the engine abstains and retries rather than voting no.
 */

export type CheckItem = { label: string; passed: boolean; detail: string };
export type CheckReport = {
  kind: Check["kind"];
  url: string;
  items: CheckItem[];
  /** Set when the evidence could not be examined; the engine then abstains. */
  error: string | null;
  /** What the engine saw, trimmed, for the model and the report. */
  excerpt: string;
};

const MAX_PAGE_BYTES = 512 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "AccrueProofEngine/1.0 (+https://github.com/pauleke65/accrue-arc)";

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN?.trim();
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Refuses anything but public HTTPS hosts, including names that resolve privately. */
async function assertPublic(url: string): Promise<void> {
  publicHttpsUrl.parse(url);
  const { hostname } = new URL(url);
  // Local development behind a proxy cannot resolve names itself.
  if (process.env.ACCRUE_LOCAL_DEV === "1" && process.env.ACCRUE_DEV_SKIP_DNS === "1") return;
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address)))
    throw new Error(`${hostname} does not resolve to a public address`);
}

async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`Response exceeded the ${Math.round(limit / 1024)} KB limit`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Follows up to three redirects by hand, re-checking every hop. */
async function fetchPublic(url: string, accept: string): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; ; hop++) {
    await assertPublic(current);
    const response = await fetch(current, {
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location") && hop < 3) {
      current = new URL(response.headers.get("location")!, current).toString();
      await response.body?.cancel();
      continue;
    }
    return { response, finalUrl: current };
  }
}

/** Visible text only: scripts, styles and hidden elements don't count. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    // The lookahead keeps a bare `hidden` from consuming the tag's own `>`.
    .replace(
      /<(\w+)\b[^>]*?(?:\shidden(?=[\s>=/])|aria-hidden\s*=\s*["']?true|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function transient(status: number): boolean {
  return status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function webpage(check: Extract<Check, { kind: "webpage" }>, url: string): Promise<CheckReport> {
  const report: CheckReport = { kind: "webpage", url, items: [], error: null, excerpt: "" };
  let loaded = false;
  let found = false;
  let onHost = !check.host;
  let status: number | null = null;
  try {
    const { response, finalUrl } = await fetchPublic(url, "text/html,text/plain;q=0.9,*/*;q=0.5");
    status = response.status;
    const host = new URL(finalUrl).hostname.toLowerCase();
    onHost = !check.host || host === check.host || host.endsWith(`.${check.host}`);
    loaded = response.status === 200;
    if (transient(response.status)) report.error = `The site answered ${response.status}; the page could not be checked.`;
    const text = visibleText(await readLimited(response, MAX_PAGE_BYTES));
    found = text.toLowerCase().includes(check.text.toLowerCase().replace(/\s+/g, " "));
    report.excerpt = text.slice(0, 4000);
  } catch (error) {
    report.error = `Could not load the page: ${error instanceof Error ? error.message : "network error"}`;
  }
  report.items = [
    ...(check.host ? [{ label: "Agreed site", passed: onHost, detail: onHost ? check.host : `Must be on ${check.host}` }] : []),
    { label: "Page loads", passed: loaded, detail: status ? `HTTPS, status ${status}` : "No response" },
    { label: "Required text", passed: found, detail: found ? `Found “${check.text}”` : `“${check.text}” is not on the page` },
  ];
  return report;
}

async function pullRequest(
  check: Extract<Check, { kind: "github_pr" }>,
  url: string,
  postedAt: number,
): Promise<CheckReport> {
  const report: CheckReport = { kind: "github_pr", url, items: [], error: null, excerpt: "" };
  const [, owner, repo, , number] = new URL(url).pathname.split("/");
  let found = false;
  let rightRepo = false;
  let merged = false;
  let byAuthor = !check.author;
  let fresh = false;
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
      headers: githubHeaders(),
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    found = response.status === 200;
    if (transient(response.status)) report.error = `GitHub answered ${response.status}; the pull request could not be checked.`;
    if (found) {
      const pull = JSON.parse(await readLimited(response, MAX_PAGE_BYTES)) as {
        merged?: boolean;
        title?: string;
        body?: string | null;
        user?: { login?: string };
        created_at?: string;
        base?: { repo?: { full_name?: string } };
      };
      rightRepo = (pull.base?.repo?.full_name ?? "").toLowerCase() === check.repo.toLowerCase();
      merged = pull.merged === true;
      byAuthor = !check.author || (pull.user?.login ?? "").toLowerCase() === check.author.toLowerCase();
      fresh = !!pull.created_at && Date.parse(pull.created_at) / 1000 >= postedAt;
      report.excerpt = `Title: ${pull.title ?? ""}\n\n${(pull.body ?? "").slice(0, 3000)}`;
    } else {
      await response.body?.cancel();
    }
  } catch (error) {
    report.error = `Could not reach GitHub: ${error instanceof Error ? error.message : "network error"}`;
  }
  report.items = [
    { label: "Pull request", passed: found, detail: found ? "Found on GitHub" : "Not found or not public" },
    { label: "Target repository", passed: rightRepo, detail: rightRepo ? check.repo : `Must merge into ${check.repo}` },
    ...(check.author
      ? [{ label: "Opened by the worker", passed: byAuthor, detail: byAuthor ? `@${check.author}` : `Must be opened by @${check.author}` }]
      : []),
    { label: "Opened for this job", passed: fresh, detail: fresh ? "After the job was posted" : "Opened before the job existed" },
    { label: "Merged", passed: merged, detail: merged ? "Merged by a maintainer" : "Not merged yet" },
  ];
  return report;
}

async function jsonApi(check: Extract<Check, { kind: "json_api" }>, url: string): Promise<CheckReport> {
  const report: CheckReport = { kind: "json_api", url, items: [], error: null, excerpt: "" };
  let status: number | null = null;
  let actual: string | null = null;
  try {
    const { response } = await fetchPublic(url, "application/json");
    status = response.status;
    if (transient(response.status)) report.error = `The endpoint answered ${response.status}; it could not be checked.`;
    const raw = await readLimited(response, MAX_JSON_BYTES);
    report.excerpt = raw.slice(0, 2000);
    const body = JSON.parse(raw) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const field = (body as Record<string, unknown>)[check.key];
      actual = field == null ? null : typeof field === "string" ? field : JSON.stringify(field);
    }
  } catch (error) {
    if (status === null) report.error = `Could not reach the endpoint: ${error instanceof Error ? error.message : "network error"}`;
  }
  const statusOk = status === 200;
  const valueOk = actual === check.value;
  report.items = [
    { label: "HTTP response", passed: statusOk, detail: status ? `Status ${status}` : "No response" },
    { label: "JSON value", passed: valueOk, detail: `${check.key}: expected ${JSON.stringify(check.value)}, got ${actual === null ? "nothing" : JSON.stringify(actual)}` },
  ];
  return report;
}

export async function runChecks(check: Check, evidence: Evidence, postedAt: number): Promise<CheckReport> {
  const problem = evidenceProblem(check, evidence.url);
  if (problem) {
    // Evidence of the wrong kind is a definite failure, not a reason to wait.
    return { kind: check.kind, url: evidence.url, items: [{ label: "Evidence", passed: false, detail: problem }], error: null, excerpt: "" };
  }
  switch (check.kind) {
    case "webpage":
      return webpage(check, evidence.url);
    case "github_pr":
      return pullRequest(check, evidence.url, postedAt);
    case "json_api":
      return jsonApi(check, evidence.url);
    case "manual":
      return { kind: "manual", url: evidence.url, items: [], error: null, excerpt: "" };
  }
}
