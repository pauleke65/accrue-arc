// Records the Accrue walkthrough: the real app, a real job on chain, captions and a visible cursor.
// BASE=<app origin> OUT=<dir> NETWORK="Arc testnet" node scripts/record-walkthrough.cjs  (needs Playwright + Chromium)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = process.env.OUT || path.join(__dirname, "video");
const NETWORK = process.env.NETWORK || "Arc testnet";
const W = 1440;
const H = 900;

const overlay = `
(() => {
  const install = () => {
    if (document.getElementById("__cap")) return;
    const style = document.createElement("style");
    style.textContent = \`
      #__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;width:min(1080px,calc(100vw - 64px));
        background:#3c3c3c;color:#fff;border-radius:8px;padding:16px 22px;display:flex;gap:18px;align-items:center;
        box-shadow:0 18px 40px -18px rgba(0,0,0,.55);pointer-events:none;font-family:"DM Sans",system-ui,sans-serif;transition:opacity .35s}
      #__cap .k{font-family:"Space Mono",monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#acc6e9;white-space:nowrap}
      #__cap .t{font-size:19px;line-height:1.35}
      #__cap.hide{opacity:0}
      #__cur{position:fixed;z-index:100000;width:22px;height:22px;border-radius:50%;pointer-events:none;
        background:rgba(233,161,63,.35);border:2px solid #e9a13f;transform:translate(-50%,-50%);transition:transform .12s, background .12s;left:-50px;top:-50px}
      #__cur.down{transform:translate(-50%,-50%) scale(.7);background:rgba(233,161,63,.7)}\`;
    document.head.appendChild(style);
    const cap = document.createElement("div");
    cap.id = "__cap"; cap.className = "hide";
    cap.innerHTML = '<span class="k"></span><span class="t"></span>';
    document.body.appendChild(cap);
    const cur = document.createElement("div");
    cur.id = "__cur";
    document.body.appendChild(cur);
    addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => cur.classList.add("down"), true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
    const saved = sessionStorage.getItem("__cap");
    if (saved) { const [k, t] = JSON.parse(saved); window.__caption(k, t); }
  };
  window.__caption = (k, t) => {
    const cap = document.getElementById("__cap");
    sessionStorage.setItem("__cap", JSON.stringify([k, t]));
    if (!cap) return;
    if (!t) { cap.classList.add("hide"); return; }
    cap.querySelector(".k").textContent = k;
    cap.querySelector(".t").textContent = t;
    cap.classList.remove("hide");
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: W / 2, y: H / 2 };

async function caption(page, key, text) {
  await page.evaluate(([k, t]) => window.__caption && window.__caption(k, t), [key, text]).catch(() => {});
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 28 });
  mouse = { x, y };
  await sleep(250);
}

async function click(page, locator) {
  const top = await locator.evaluate((el) => el.getBoundingClientRect().top);
  if (top < 90 || top > 640) {
    const target = await locator.evaluate((el) => el.getBoundingClientRect().top + scrollY - innerHeight * 0.4);
    await glide(page, Math.max(0, target), 900);
  }
  await moveTo(page, locator);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

async function glide(page, to, ms = 2200) {
  const from = await page.evaluate(() => scrollY);
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.evaluate((y) => scrollTo(0, y), from + (to - from) * eased);
    await sleep(16);
  }
}

async function typeSlow(page, locator, text) {
  await click(page, locator);
  await locator.pressSequentially(text, { delay: 28 });
}

async function card(page, html, ms) {
  await page.setContent(`<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=Space+Grotesk:wght@300&family=Space+Mono&display=swap" rel="stylesheet">
    <style>
      html,body{margin:0;height:100%}
      body{display:grid;place-items:center;font-family:"DM Sans",sans-serif;color:#1b3158;
        background:radial-gradient(80rem 30rem at 50% 115%,rgb(246 216 186/.95),transparent 70%),linear-gradient(180deg,#9fd0f8 0%,#cfe6fa 38%,#eef0f2 66%,#f7e6d6 100%)}
      .k{font-family:"Space Mono",monospace;letter-spacing:.2em;text-transform:uppercase;font-size:15px}
      .k:before{content:"{";color:#e9a13f;margin-right:.2em}.k:after{content:"}";color:#e9a13f;margin-left:.2em}
      h1{font-family:"Space Grotesk",sans-serif;font-weight:300;font-size:84px;letter-spacing:-.035em;line-height:1.02;margin:22px 0}
      p{font-size:24px;line-height:1.45;margin:0;color:#2c3e5f;max-width:900px}
      .wrap{text-align:center;padding:0 80px}
      .m{font-family:"Space Mono",monospace;font-size:16px;margin-top:34px;color:#2f578c}
    </style></head><body><div class="wrap">${html}</div></body></html>`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(ms);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--ignore-certificate-errors"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();
  const t0 = Date.now();
  const mark = (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);

  // 1. Title
  await card(
    page,
    `<div class="k">Arc Microgrants</div><h1>Accrue on Arc</h1><p>Pay for work when it's proven done. Outcome jobs in USDC, verified by an agent and the people you name, settled in under a second.</p>`,
    4200,
  );
  mark("title");

  // 2. Landing
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.mouse.move(mouse.x, mouse.y);
  await caption(page, "Accrue", "An outcome marketplace on Arc: post an objective, lock a USDC budget, and pay only when the work is verified.");
  await sleep(4200);
  await caption(page, "Rules", "The contracts enforce the rules for both sides. Silence pays the worker; nothing delivered refunds the client; no admin keys.");
  const rules = await page.locator("h2", { hasText: "Fair to both sides" }).evaluate((el) => el.getBoundingClientRect().top + scrollY - 120);
  await glide(page, rules, 2600);
  await sleep(3000);
  await caption(page, "Why Arc", "Built on Arc's own standards: ERC-8183 jobs, an ERC-8004 agent identity, USDC for gas, a USDC permit for one-transaction posting.");
  const why = await page.locator("h2", { hasText: "Built for Arc" }).evaluate((el) => el.getBoundingClientRect().top + scrollY - 140);
  await glide(page, why, 2200);
  await sleep(3600);
  await glide(page, 0, 1800);
  mark("landing");

  // 3. Live job
  await caption(page, `Live on ${NETWORK}`, "Run a real job end to end: two demo accounts, the Proof Engine agent, and the contracts. Every step is a transaction.");
  await sleep(1400);
  await click(page, page.getByRole("button", { name: /Run a live job|Run another/ }));
  await page
    .getByText(/transactions, each final in under a second/)
    .first()
    .waitFor({ timeout: 90_000 })
    .catch(async (e) => {
      console.log("DEMO STATE:\n" + (await page.locator("#demo").innerText().catch(() => "?")));
      await page.screenshot({ path: path.join(OUT, "fail.png") });
      throw e;
    });
  await caption(page, "Settled", "Posted, delivered, checked by the Proof Engine and paid: each transaction final in under a second, every fee paid in USDC.");
  const summary = page.getByText(/transactions, each final in under a second/).first();
  await moveTo(page, summary);
  await sleep(4800);
  mark("live job");

  // 4. Job page
  const open = page.getByRole("link", { name: /Open job #/ });
  const jobHref = await open.getAttribute("href");
  await click(page, open);
  await page.waitForURL("**" + jobHref, { waitUntil: "commit" });
  await page.getByText("The panel's verdict").first().waitFor({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  await caption(page, "On chain", "The job page reads straight from Arc: the brief, the evidence, and the Proof Engine's report as published in its vote.");
  await sleep(3800);
  const verdict = await page.getByText("The panel's verdict", { exact: false }).first().evaluate((el) => el.getBoundingClientRect().top + scrollY - 100);
  await glide(page, verdict, 2200);
  await caption(page, "Proof Engine", "The agent checked the agreed facts itself (the site, the page, the required text) and voted pass. The contract paid at once.");
  await sleep(4800);
  const paidTx = page.locator("li", { hasText: "Paid" }).locator("a[href*='/tx/']").first();
  const txHref = await paidTx.getAttribute("href");
  await moveTo(page, paidTx);
  await sleep(900);
  mark("job page");

  // 5. Explorer
  await page.mouse.down();
  await page.mouse.up();
  await page.goto(txHref, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.addStyleTag({ content: "" }).catch(() => {});
  await page.evaluate(overlay).catch(() => {});
  await caption(page, "Explorer", "Every step is a real transaction you can open on Arc's explorer.");
  await sleep(5200);
  mark("explorer");

  // 6. Posting
  await page.goto(BASE + "/post", { waitUntil: "networkidle" });
  await caption(page, "Post a job", "Say what done looks like. The brief and its definition of done are stored on chain with the job.");
  await typeSlow(page, page.getByPlaceholder("Add a pricing page to our site"), "Ship our pricing page");
  await typeSlow(page, page.getByPlaceholder(/A pricing page with our three plans/), "Three plans, linked from the main navigation.");
  await sleep(600);
  await caption(page, "Definition of done", "A live page, a merged pull request, an API value, or people's judgement. The Proof Engine checks the facts itself.");
  await click(page, page.getByRole("button", { name: /Merged pull request/ }));
  await sleep(1500);
  await click(page, page.getByRole("button", { name: /Live web page/ }));
  await typeSlow(page, page.getByPlaceholder("Plans start at $9"), "Plans start at $9");
  await sleep(800);
  await caption(page, "The panel", "Pick who decides: the Proof Engine alone, the engine with two people (two of three), or the client.");
  await click(page, page.getByRole("button", { name: /Proof Engine \+ two reviewers/ }));
  await sleep(4200);
  await caption(page, "One transaction", "Sign in with a passkey or a wallet. A USDC permit lets the post and the escrow happen in a single transaction.");
  await glide(page, await page.evaluate(() => document.body.scrollHeight - innerHeight - 380), 2000);
  await sleep(4000);
  mark("post");

  // 7. Agents
  await page.goto(BASE + "/agents", { waitUntil: "networkidle" });
  await caption(page, "For agents", "Agents are first-class: they can hire, work and review straight from the contracts, with copyable viem code.");
  await sleep(2000);
  await glide(page, 620, 2600);
  await sleep(2800);
  mark("agents");

  // 8. Status
  await page.goto(BASE + "/status", { waitUntil: "networkidle" });
  await caption(page, "Transparency", "The server deployed its own contracts through Arc's CREATE2 factory, verified them and registered its agent. All public.");
  await sleep(5600);
  mark("status");

  // 9. End
  await caption(page, "", "");
  await card(
    page,
    `<div class="k">Accrue on Arc</div><h1>Proven done, then paid.</h1><p>ERC-8183 jobs · ERC-8004 agent · USDC gas · ownerless contracts</p><div class="m">accrue-arc.up.railway.app · github.com/pauleke65/accrue-arc</div>`,
    4500,
  );
  mark("end");

  const video = page.video();
  await context.close();
  const file = await video.path();
  fs.renameSync(file, path.join(OUT, "walkthrough.webm"));
  await browser.close();
  console.log("saved", path.join(OUT, "walkthrough.webm"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
