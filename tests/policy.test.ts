import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeAbiParameters, keccak256, stringToHex } from "viem";
import {
  decodeBrief,
  decodeEvidence,
  describeCheck,
  encodeBrief,
  encodeEvidence,
  encodePanel,
  evidenceProblem,
  expiryFor,
  SETTLE_GRACE,
  type Brief,
} from "../lib/policy";

const brief: Brief = {
  v: 1,
  app: "accrue",
  title: "Add a pricing page",
  brief: "Three plans, linked from the navigation.",
  check: { kind: "webpage", text: "Plans start at $9", host: "example.com" },
};

test("a brief round-trips through its on-chain form", () => {
  const onChain = encodeBrief(brief);
  assert.equal(typeof onChain, "string");
  assert.deepEqual(decodeBrief(onChain), brief);
});

test("descriptions that are not Accrue briefs decode to null", () => {
  assert.equal(decodeBrief("ERC-8183 demo job on Arc Testnet"), null);
  assert.equal(decodeBrief(JSON.stringify({ ...brief, app: "other" })), null);
  assert.equal(decodeBrief(JSON.stringify({ ...brief, check: { kind: "teleport" } })), null);
});

test("invalid briefs are refused before they reach the chain", () => {
  assert.throws(() => encodeBrief({ ...brief, title: "x" }));
  assert.throws(() => encodeBrief({ ...brief, check: { kind: "github_pr", repo: "not a repo" } }));
});

test("evidence hashes to the deliverable and travels as abi-encoded string", () => {
  const { json, deliverable, optParams } = encodeEvidence({ v: 1, url: "https://example.com/pricing", notes: "Done" });
  assert.equal(deliverable, keccak256(stringToHex(json)));
  const [decoded] = decodeAbiParameters([{ type: "string" }], optParams);
  assert.equal(decoded, json);
  assert.deepEqual(decodeEvidence(json), { v: 1, url: "https://example.com/pricing", notes: "Done" });
});

test("evidence links must be public https", () => {
  for (const url of ["http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@example.com", "https://example.com:8443/x", "https://router.local/"]) {
    assert.throws(() => encodeEvidence({ v: 1, url, notes: "" }), url);
  }
});

test("evidence must be the kind of thing the check can look at", () => {
  const pr = { kind: "github_pr", repo: "acme/site" } as const;
  assert.equal(evidenceProblem(pr, "https://github.com/acme/site/pull/42"), null);
  assert.match(evidenceProblem(pr, "https://github.com/other/site/pull/42")!, /acme\/site/);
  assert.match(evidenceProblem(pr, "https://gitlab.com/acme/site/-/merge_requests/1")!, /pull request/);
  const page = { kind: "webpage", text: "hi", host: "example.com" } as const;
  assert.equal(evidenceProblem(page, "https://docs.example.com/a"), null);
  assert.match(evidenceProblem(page, "https://example.org/a")!, /example\.com/);
});

test("expiry leaves a full grace period after the latest end of review", () => {
  const deliverBy = 1_800_000_000;
  const window = 6 * 3600;
  assert.ok(expiryFor(deliverBy, window) >= deliverBy + window + SETTLE_GRACE);
});

test("panel config encodes exactly as AccruePanel decodes it", () => {
  const reviewers = ["0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"] as const;
  const encoded = encodePanel({ reviewers: [...reviewers], threshold: 2, reviewWindow: 3600, deliverBy: 1_800_000_000 });
  const [r, t, w, d] = decodeAbiParameters(
    [{ type: "address[]" }, { type: "uint8" }, { type: "uint32" }, { type: "uint64" }],
    encoded,
  );
  assert.deepEqual(r, reviewers);
  assert.equal(t, 2);
  assert.equal(w, 3600);
  assert.equal(d, 1_800_000_000n);
});

test("checks read as plain sentences", () => {
  assert.equal(describeCheck(brief.check), "A live page on example.com shows “Plans start at $9”");
  assert.equal(describeCheck({ kind: "json_api", key: "status", value: "ok" }), 'An endpoint returns status = "ok"');
});
