# Demo plan

How to show Accrue to Arc Microgrants reviewers: the recorded walkthrough, the mainnet re-record, a live run for a call, and the questions to expect.

Reviewers judge four things: **relevance to Arc**, **technical credibility**, **the quality of what was built**, and **whether it's worth taking further**. Promise counts for more than traction. Every scene below is there to prove one of these, and the table says which.

## What exists today

| Asset | Where | Status |
|---|---|---|
| Walkthrough video, 2:16, Arc testnet | [`docs/media/accrue-arc-walkthrough.mp4`](media/accrue-arc-walkthrough.mp4) | Recorded from the public testnet deployment; every transaction is real |
| Testnet deployment | https://accrue-arc-testnet.up.railway.app | Live: contracts deployed and source-verified, Proof Engine is ERC-8004 agent #896921 |
| Mainnet deployment | https://accrue-arc.up.railway.app | Live, waiting for its first USDC (see the checklist below) |
| Recorder | [`scripts/record-walkthrough.cjs`](../scripts/record-walkthrough.cjs) | Drives the real UI with captions and a visible cursor; re-records against any deployment |

## 1. Mainnet go-live checklist

Do this before re-recording or submitting. It takes about five minutes once the USDC is there.

1. **Fund the operations wallet** `0xA9D86D4F5C92d0B19Fc93a5C087966920e699a74` on Arc mainnet (chain 5042). The minimum is 0.35 USDC; 1 USDC covers about 30 live demos, and 2 USDC is comfortable through the review period (decisions by Oct 21).
2. **Watch [/status](https://accrue-arc.up.railway.app/status).** Within about a minute it should show both contracts deployed, the Proof Engine and demo wallets topped up, and the Proof Engine registered on ERC-8004 with an agent number.
3. **Pin the agent id.** Set `ACCRUE_ENGINE_AGENT_ID` on the mainnet service in Railway (`web`, or `accrue-arc-mainnet` once renamed) to that number, so restarts don't have to search for it.
4. **Check source verification.** /status shows "Source verified on the explorer". If it reports a failure (explorer.arc.io's API sits behind Cloudflare), verify from a laptop instead:
   ```sh
   cd contracts
   forge verify-contract 0xD40e540f1e89994B2973ffAc971C2C20BcDC87c5 src/AccrueJobs.sol:AccrueJobs \
     --verifier blockscout --verifier-url https://explorer.arc.io/api/ --chain 5042 \
     --constructor-args $(cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000)
   forge verify-contract 0x6b2942195DC4fD2399def0Da79033ec41c4eA3c3 src/AccruePanel.sol:AccruePanel \
     --verifier blockscout --verifier-url https://explorer.arc.io/api/ --chain 5042 \
     --constructor-args $(cast abi-encode "constructor(address)" 0xD40e540f1e89994B2973ffAc971C2C20BcDC87c5)
   ```
5. **Run one live job** from the home page and open its "Paid" transaction on the explorer. This is the proof reviewers will check first.
6. **Submit** with the answers in [`SUBMISSION.md`](SUBMISSION.md). Earlier submissions hear back earlier.

## 2. The recorded walkthrough, scene by scene

Target length is about two minutes. The captions in the video carry the story, so it works muted; the narration column is for an optional voiceover.

| # | Time | Screen and action | Caption / narration | Proves |
|---|---|---|---|---|
| 1 | 0:00 | Title card on Arc's sky gradient: "Accrue on Arc" | "Pay for work when it's proven done. Outcome jobs in USDC, verified by an agent and the people you name, settled in under a second." | Relevance: Arc's "outcome marketplaces" Request for Builders |
| 2 | 0:05 | Home page hero, then a slow scroll to the rules | "An outcome marketplace on Arc: post an objective, lock a USDC budget, and pay only when the work is verified." / "The contracts enforce the rules for both sides. Silence pays the worker; nothing delivered refunds the client; no admin keys." | Quality, credibility |
| 3 | 0:20 | Scroll to "Why Arc", then back up | "Built on Arc's own standards: ERC-8183 jobs, an ERC-8004 agent identity, USDC for gas, a USDC permit for one-transaction posting." | Relevance |
| 4 | 0:28 | Press **Run a live job**; the four steps tick off with timings and fees | "Run a real job end to end: two demo accounts, the Proof Engine agent, and the contracts. Every step is a transaction." / "Posted, delivered, checked by the Proof Engine and paid: each transaction final in under a second, every fee paid in USDC." | Relevance (sub-second finality, USDC gas), credibility |
| 5 | 0:42 | **Open job #N**: brief, definition of done, parties, terms; scroll to the panel's verdict | "The job page reads straight from Arc: the brief, the evidence, and the Proof Engine's report as published in its vote." / "The agent checked the agreed facts itself (the site, the page, the required text) and voted pass. The contract paid at once." | Quality, credibility |
| 6 | 1:00 | Click the **Paid** transaction: Arc's explorer shows `vote` on AccruePanel and 0.1 USDC moving to the worker, confirmed within half a second | "Every step is a real transaction you can open on Arc's explorer." | Credibility |
| 7 | 1:15 | **Post a job**: type a title and brief, flick between definition-of-done types, choose "Proof Engine + two reviewers" | "Say what done looks like. The brief and its definition of done are stored on chain with the job." / "A live page, a merged pull request, an API value, or people's judgement." / "Pick who decides." / "Sign in with a passkey or a wallet. A USDC permit lets the post and the escrow happen in a single transaction." | Quality, worth taking further |
| 8 | 1:45 | **For agents**: contract addresses, ERC-8004 agent, copyable viem code | "Agents are first-class: they can hire, work and review straight from the contracts, with copyable viem code." | Relevance (agentic economy), worth taking further |
| 9 | 1:55 | **Status**: wallets, deployment, verification, agent id | "The server deployed its own contracts through Arc's CREATE2 factory, verified them and registered its agent. All public." | Credibility |
| 10 | 2:05 | End card: "Proven done, then paid." with the app and repo links | — | — |

### Re-recording on mainnet

Once the checklist above is done, record the same walkthrough against mainnet so the video and the submission tell the same story:

```sh
npm i -D playwright && npx playwright install chromium   # once
BASE=https://accrue-arc.up.railway.app NETWORK="Arc mainnet" OUT=./video \
  node scripts/record-walkthrough.cjs
ffmpeg -i video/walkthrough.webm -c:v libx264 -crf 24 -pix_fmt yuv420p -movflags +faststart -an docs/media/accrue-arc-walkthrough.mp4
```

The live job costs about 0.02 USDC in fees. If a take goes wrong, wait 15 seconds (the demo's cooldown) and run it again.

### Optional voiceover

Read over the video at an easy pace (about 2:05):

> Accrue is an outcome marketplace on Arc. You post an objective with a USDC budget, and it stays locked until the work is verified.
>
> The rules are in the contracts, and they're fair to both sides. If reviewers go silent, the worker is still paid. If nothing is delivered, the client gets everything back. And there are no admin keys, not even ours.
>
> It's built on Arc's own standards: ERC-8183 for jobs, ERC-8004 for our agent's identity, USDC for gas, and a USDC permit so posting and funding is one transaction.
>
> Let's run a real job. A client posts and locks the budget, a worker publishes a page and submits it, and our Proof Engine fetches the page, checks the agreed text and votes. The contract pays the worker. Each step was final in under a second, and every fee was paid in USDC.
>
> Everything on this page comes straight from the chain: the brief, the evidence, and the agent's full report, which it published in its vote. Here's the payment on Arc's explorer.
>
> Posting a job means saying what done looks like: a live page, a merged pull request, an API value, or a person's judgement. Then you choose who decides: the Proof Engine, the engine plus two people, or yourself.
>
> Agents can do all of this straight from the contracts. And the server deployed its own contracts, verified them and registered its agent, in public.
>
> Accrue: proven done, then paid.

## 3. A live demo on a call (5 minutes)

For a reviewer call or a follow-up pitch. Open these tabs first: the home page, a finished job page, /post, /agents and /status. Sign in with a passkey beforehand so no prompt surprises you.

1. **The problem (30 s).** Paying for work online means trusting someone: the client trusts the worker to deliver, and the worker trusts the client to pay. Arc's Requests for Builders ask for outcome marketplaces that remove that trust, and Accrue is one.
2. **Run a live job (60 s).** Press Run a live job and talk over the four steps: one permit-funded post, the delivery, the Proof Engine's check, and the payout vote. Point at the timings and the fees.
3. **The job page (60 s).** Open the job. Walk down the brief, the definition of done, the evidence hash the panel checked, the Proof Engine's per-check report, and the timeline with a transaction per step. Open the payout on the explorer.
4. **The rules (45 s).** Silence pays the worker. Nothing delivered refunds the client. Only the panel can refund funded work, and client and worker together can call a job off. There's no admin key, and claimRefund can't be blocked by any hook.
5. **Post a job (45 s).** Build a "Proof Engine + two reviewers" job and show the review window and deadline the worker sees before starting. If you have USDC in the account, post it: one signature, one transaction.
6. **Agents and transparency (30 s).** /agents for the contracts and viem code, /status for the self-deployment, verification and ERC-8004 registration.
7. **Where it goes (30 s).** Onramp Kit so clients fund by card, Circle Agent Stack wallets as workers, ERC-8004 reputation for every completed job, milestone jobs, and a first corridor for remote work in Nigeria and West Africa.

**If something stalls:** the RPC occasionally answers late on the newest block, so wait a few seconds and press Run another. If the demo says its accounts are being topped up, ops is low: send it 1 USDC. If the live run fails on a call, play the recorded video instead.

## 4. Questions to expect

- **Why not use Arc's reference ERC-8183 contract?** It's deployed on testnet only. Ours is a spec-faithful kernel (including the `expectedBudget` guard on `fund` and a `claimRefund` no hook can block) running on mainnet, plus one-transaction permit extensions.
- **What stops the AI from being wrong?** It only rules alone when the client chooses that. It checks facts before any judgement, abstains when it can't check, and publishes its full report on chain. With people on the panel, doubt goes to them.
- **What stops a client from never approving?** The review window. If the panel is silent when it ends, anyone can settle the job and the worker is paid.
- **Is it audited?** No. The contracts are prototypes, ownerless and covered by 61 Foundry tests including fuzzing and invariants, but not independently audited. Before allowing larger amounts we would get an external review.
- **Who holds the server's keys?** Nobody has seen them. They're derived from a seed Railway generated, and the server only ever holds its demo, engine and operations wallets, never user funds.
- **What does it cost to run?** About 0.084 USDC to deploy, then about 0.02 USDC per live demo. The README lists the measured gas.
- **What would the 500 USDC go to?** A focused external review of the two contracts, mainnet running costs for the Proof Engine and demos, and the Onramp Kit integration.
