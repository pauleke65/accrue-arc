import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from "viem";
import { z } from "zod";

/**
 * What a job asks for, and how it will be checked. The brief is stored on
 * chain as the ERC-8183 job `description` (plain JSON, so any ERC-8183 reader
 * can show it), and every delivery's evidence travels with the submission and
 * is recorded in the panel's Delivered event. Nothing about a job lives in a
 * database.
 */

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Use a host name like example.com");

const repo = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "Use owner/repository, like acme/website");

export const checkSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("webpage"),
      /** Text the live page must show. */
      text: z.string().trim().min(2).max(200),
      /** The site it must be on, so any page with the text won't do. */
      host: host.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("github_pr"),
      /** The pull request must be merged into this repository… */
      repo,
      /** …and, if set, opened by this GitHub account. */
      author: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9-]{1,39}$/, "A GitHub username")
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json_api"),
      /** The endpoint must answer 200 with this top-level key… */
      key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/, "A top-level JSON key"),
      /** …holding this value. */
      value: z.string().max(120),
      host: host.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("manual"),
      /** What the reviewers will look for. Nothing is checked automatically. */
      criteria: z.string().trim().min(10).max(1000),
    })
    .strict(),
]);

export const briefSchema = z
  .object({
    v: z.literal(1),
    app: z.literal("accrue"),
    title: z.string().trim().min(3).max(120),
    brief: z.string().trim().min(10).max(1500),
    check: checkSchema,
  })
  .strict();

export type Check = z.infer<typeof checkSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type CheckKind = Check["kind"];

export const publicHttpsUrl = z
  .string()
  .trim()
  .url("Use a full link starting with https://")
  .refine((value) => {
    try {
      const url = new URL(value);
      // The Proof Engine fetches this from a server, so only public HTTPS
      // names: no credentials, ports, bare IPs or local host names.
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.hostname.includes(".") &&
        !/^[\d.]+$/.test(url.hostname) &&
        !url.hostname.includes(":") &&
        !/(^|\.)(localhost|local|internal|lan|home)$/i.test(url.hostname)
      );
    } catch {
      return false;
    }
  }, "Use a public https:// link");

export const evidenceSchema = z
  .object({
    v: z.literal(1),
    url: publicHttpsUrl,
    notes: z.string().trim().max(1000),
  })
  .strict();

export type Evidence = z.infer<typeof evidenceSchema>;

/** The exact string stored on chain. Key order is fixed by construction. */
export function encodeBrief(brief: Brief): string {
  return JSON.stringify(briefSchema.parse(brief));
}

/** Parses an on-chain description; other ERC-8183 jobs simply return null. */
export function decodeBrief(description: string): Brief | null {
  try {
    const parsed = briefSchema.safeParse(JSON.parse(description));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeEvidence(evidence: Evidence): { json: string; deliverable: Hex; optParams: Hex } {
  const json = JSON.stringify(evidenceSchema.parse(evidence));
  return {
    json,
    deliverable: keccak256(stringToHex(json)),
    optParams: encodeAbiParameters([{ type: "string" }], [json]),
  };
}

export function decodeEvidence(json: string): Evidence | null {
  try {
    const parsed = evidenceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Evidence must be the kind of thing the job's check can look at. */
export function evidenceProblem(check: Check, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That is not a link.";
  }
  const hostname = parsed.hostname.toLowerCase();
  if (check.kind === "github_pr") {
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d{1,7})\/?$/);
    if (hostname !== "github.com" || !match) return "Link the pull request, like https://github.com/owner/repo/pull/42.";
    if (`${match[1]}/${match[2]}`.toLowerCase() !== check.repo.toLowerCase())
      return `The pull request must be on ${check.repo}.`;
    return null;
  }
  if ((check.kind === "webpage" || check.kind === "json_api") && check.host) {
    if (hostname !== check.host && !hostname.endsWith(`.${check.host}`)) return `The link must be on ${check.host}.`;
  }
  return null;
}

/** Human summary of a check, for cards and the review screen. */
export function describeCheck(check: Check): string {
  switch (check.kind) {
    case "webpage":
      return `A live page${check.host ? ` on ${check.host}` : ""} shows “${check.text}”`;
    case "github_pr":
      return `A pull request merged into ${check.repo}${check.author ? ` by @${check.author}` : ""}`;
    case "json_api":
      return `An endpoint${check.host ? ` on ${check.host}` : ""} returns ${check.key} = ${JSON.stringify(check.value)}`;
    case "manual":
      return check.criteria;
  }
}

export const CHECK_LABELS: Record<CheckKind, string> = {
  webpage: "Live web page",
  github_pr: "Merged pull request",
  json_api: "API response",
  manual: "Reviewed by people",
};

/** True when the Proof Engine can decide the job on facts alone. */
export function machineCheckable(check: Check): boolean {
  return check.kind !== "manual";
}

// ─── Panels ───

export type PanelConfig = {
  reviewers: Address[];
  threshold: number;
  reviewWindow: number;
  deliverBy: number;
};

export function encodePanel(config: PanelConfig): Hex {
  return encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint8" }, { type: "uint32" }, { type: "uint64" }],
    [config.reviewers, config.threshold, config.reviewWindow, BigInt(config.deliverBy)],
  );
}

/** Mirrors AccruePanel.SETTLE_GRACE. */
export const SETTLE_GRACE = 86_400;

/**
 * Job expiry: after delivery closes and review ends there is a full grace
 * period in which a silent panel's job can be settled, before anyone could
 * claim a refund. A little slack covers the gap between signing and mining.
 */
export function expiryFor(deliverBy: number, reviewWindow: number): number {
  return deliverBy + reviewWindow + SETTLE_GRACE + 600;
}
