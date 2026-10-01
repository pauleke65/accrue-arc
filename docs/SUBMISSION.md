# Arc Microgrants: DoraHacks submission

Answers for each field on https://dorahacks.io/hackathon/arc-microgrants, ready to paste. Submissions are reviewed on a rolling basis and earlier ones hear back earlier, so submit as soon as the mainnet run below is done.

**Before submitting, check:**

1. `/status` shows both contracts deployed and the Proof Engine registered on ERC-8004.
2. At least one live-demo job is paid on mainnet.
3. The repo link points at the public `accrue-arc` repo.

---

**1. Project name**
Accrue on Arc

**2. Your name, alias, or team name**
PIE Drops Studio (Paul Imoke and Victor Shallangwa)

**3. Contact email**
pauleke65@gmail.com

**4. Public builder profiles (GitHub, X, Farcaster)**
GitHub: https://github.com/pauleke65 · X: https://x.com/PaulEke20

**5. Link to your live deployment on Arc mainnet**
https://accrue-arc.up.railway.app

**6. Arc mainnet contract address or a transaction hash we can verify**
AccrueJobs (ERC-8183 job escrow): `0xD40e540f1e89994B2973ffAc971C2C20BcDC87c5`
AccruePanel (evaluator + hook): `0x6b2942195DC4fD2399def0Da79033ec41c4eA3c3`
https://explorer.arc.io/address/0xD40e540f1e89994B2973ffAc971C2C20BcDC87c5

**7. Public repo**
https://github.com/pauleke65/accrue-arc

**8. In two sentences, what does your project do?**
Accrue is an outcome marketplace on Arc: anyone, human or agent, posts an objective with a USDC budget that stays locked in an ERC-8183 escrow until the work is verified, then the worker is paid in under a second. A panel decides, made of Accrue's Proof Engine (an ERC-8004 agent that checks live pages, merged pull requests and API responses and publishes its report on chain) and any people the client names, and if the panel stays silent past its window the worker is still paid.

**9. What does it use Arc for?**
Arc is the whole stack:

- **USDC:** escrow, payouts and network fees, so a worker can act on what they earn with no gas token to buy.
- **Sub-second finality:** each payment is final when the vote lands.
- **ERC-8183:** our ownerless job contract. Arc's reference implementation is testnet-only; ours runs on mainnet.
- **ERC-8004:** the Proof Engine's on-chain agent identity.
- **USDC permit:** posting and funding a job is one transaction.
- **CREATE2 factory:** deterministic deployment.

**10. Had you deployed to Arc before this project?**
No

**11. Have you received a Circle or Arc grant, bounty, or prize for this project?**
No

**12. Anything else we should see?**
Press "Run a live job" on the home page. It runs a real 0.10 USDC job on mainnet: post and lock with one permit, deliver, the Proof Engine checks, the contract pays. Each step shows its transaction, time to finality and fee. A two-minute walkthrough recorded on Arc testnet: https://github.com/pauleke65/accrue-arc/blob/main/docs/media/accrue-arc-walkthrough.mp4

The contracts are ownerless with no admin keys, verified on the explorer, and covered by 61 Foundry tests including fuzzing and invariants. The site keeps no database: briefs, evidence, votes and reports all live on Arc. Agents can use the contracts directly (see /agents). The whole deployment runs on under 1 USDC; the README lists the measured gas.

Next: Onramp Kit so clients fund jobs by card, Circle Agent Stack wallets as workers with spend limits, and ERC-8004 reputation written for every completed job.

Accrue began at Monad Metropolis; this is a ground-up rebuild around Arc's standards and USDC-native money.

---

## Judging criteria → evidence

| Criterion | What a reviewer can check in two minutes |
|---|---|
| **Relevance to Arc** | It answers Arc's "outcome marketplaces" Request for Builders word for word. It implements ERC-8183, uses ERC-8004 and native USDC for gas and settlement, and is built around sub-second finality, Arc's USDC permit and its CREATE2 factory. |
| **Technical credibility** | Ownerless, non-upgradeable contracts, source verified on the explorer. 61 Foundry tests with invariants. Spec-faithful ERC-8183 (the `expectedBudget` guard, an unhookable `claimRefund`). SSRF-hardened evidence fetching. Arc specifics handled: the 20 gwei floor, 6- versus 18-decimal USDC, and the 10k-block log limit avoided by design. |
| **Quality of what was built** | A live mainnet demo with real transactions and timings, passkey sign-in, a definition-of-done builder, readable job pages with reports, a status page with full transparency, and a responsive layout. |
| **Worth taking further** | The roadmap follows Arc's launch: Onramp Kit and CCTP funding, Circle Agent Stack wallets as workers, reviewer fees, ERC-8004 reputation for agent workers, milestone jobs, and a West Africa remote-work corridor. Already used in a hackathon setting, and positioned for the Circle Grant Program. |
