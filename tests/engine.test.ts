import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief } from "../lib/policy";
import { visibleText, type CheckReport } from "../lib/server/checks";
import { decide } from "../lib/server/engine";

const webBrief: Brief = { v: 1, app: "accrue", title: "Page", brief: "A page with the phrase.", check: { kind: "webpage", text: "hello" } };
const passed: CheckReport = { kind: "webpage", url: "https://x.io", items: [{ label: "Page loads", passed: true, detail: "200" }], error: null, excerpt: "" };
const failed: CheckReport = { ...passed, items: [{ label: "Required text", passed: false, detail: "not found" }] };
const errored: CheckReport = { ...failed, error: "The site answered 503" };
const ai = (met: number, review: number) => ({ requirementsMet: met, needsHumanReview: review, reason: "because", model: "claude-opus-5-5" });

test("a failed check is a fail vote; a check that could not run is not", () => {
  assert.equal(decide(webBrief, failed, null, true, 1).verdict, "fail");
  const e = decide(webBrief, errored, null, true, 1);
  assert.equal(e.verdict, "abstain");
  assert.equal(e.retry, true);
});

test("without a model, passing checks are a pass", () => {
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(decide(webBrief, passed, null, false, 1).verdict, "pass");
});

test("with a model: confident pass, confident fail, doubt goes to people", () => {
  process.env.ANTHROPIC_API_KEY = "test";
  assert.equal(decide(webBrief, passed, ai(0.97, 0.05), false, 1).verdict, "pass");
  assert.equal(decide(webBrief, passed, ai(0.05, 0.9), false, 1).verdict, "fail");
  assert.equal(decide(webBrief, passed, ai(0.6, 0.6), false, 1).verdict, "abstain");
  // Alone on the panel, checks that passed carry the job unless the model is sure.
  assert.equal(decide(webBrief, passed, ai(0.6, 0.6), true, 1).verdict, "pass");
  // An unavailable model is retried, then the checks decide.
  assert.equal(decide(webBrief, passed, null, false, 1).verdict, "abstain");
  assert.equal(decide(webBrief, passed, null, false, 3).verdict, "pass");
  delete process.env.ANTHROPIC_API_KEY;
});

test("jobs judged by people are left to people", () => {
  const manual: Brief = { ...webBrief, check: { kind: "manual", criteria: "Three logo concepts as SVG" } };
  assert.equal(decide(manual, { ...passed, kind: "manual", items: [] }, null, false, 1).verdict, "abstain");
});

test("only text a visitor can see counts", () => {
  const html = `<html><head><style>.x{}</style><script>var hello=1</script></head><body>
    <p>Visible &amp; real</p><div hidden>hello hidden</div><span style="display:none">hello css</span>
    <!-- hello comment --><p aria-hidden="true">hello aria</p></body></html>`;
  const text = visibleText(html);
  assert.ok(text.includes("Visible & real"));
  assert.ok(!text.toLowerCase().includes("hello"));
});
