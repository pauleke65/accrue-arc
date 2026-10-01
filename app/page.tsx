import Link from "next/link";
import { ArrowRight, BadgeCheck, Bot, Clock3, KeyRound, ScrollText, ShieldCheck, Signature, Undo2, Zap } from "lucide-react";
import { JobCard } from "@/components/job-card";
import { LiveDemo } from "@/components/live-demo";
import { ButtonLink, Stat, Usdc } from "@/components/ui";
import { CONTRACTS, ERC8004, explorer } from "@/lib/arc";
import { contractsDeployed, readRecentJobs, totals, type JobView } from "@/lib/jobs";
import { setupState } from "@/lib/server/bootstrap";
import { cached } from "@/lib/server/http";
import { walletAddresses } from "@/lib/server/wallets";

export const dynamic = "force-dynamic";

async function load() {
  try {
    return await cached("landing", 4_000, async () => {
      const deployed = await contractsDeployed();
      if (!deployed) return { deployed, total: 0, jobs: [] as JobView[] };
      const { total, jobs } = await readRecentJobs(100);
      return { deployed, total, jobs };
    });
  } catch {
    return { deployed: false, total: 0, jobs: [] as JobView[] };
  }
}

const STEPS = [
  {
    title: "Lock the budget",
    body: "Describe the outcome and how it will be checked. One signature posts and funds the job: a USDC permit and the job travel in a single transaction, and the brief is stored on chain with it.",
  },
  {
    title: "Deliver with evidence",
    body: "The worker, human or agent, submits a link: a live page, a merged pull request, an API response. The evidence is written on chain with the submission, so it can't be swapped later.",
  },
  {
    title: "Verify, then release",
    body: "The panel votes. The Proof Engine checks the facts first, can ask a model whether the brief is met, and publishes its report in its vote. A passing quorum pays the worker at once.",
  },
];

const RULES = [
  { icon: Clock3, title: "Silence is not a no", body: "If the panel lets the review window pass, the delivery is paid. A client can't keep work by naming reviewers who never answer." },
  { icon: ShieldCheck, title: "Delivered work can't be clawed back", body: "Once a job is funded, only its panel can refund it. The client alone never can." },
  { icon: Undo2, title: "Nothing delivered, nothing paid", body: "A job with no delivery by its deadline refunds the client in full, and client and worker together can call a job off." },
  { icon: KeyRound, title: "No admin keys", body: "The contracts are ownerless and can't be upgraded. Nobody, Accrue included, can move escrowed USDC outside these rules." },
  { icon: Bot, title: "The AI never rules alone", body: "Unless a client makes it the sole reviewer, the Proof Engine is one vote among people, and it abstains rather than guess." },
  { icon: ScrollText, title: "Everything on chain", body: "Briefs, evidence, votes and reports live on Arc. This site keeps no database: every page is read from the chain." },
];

export default async function Home() {
  const { deployed, total, jobs } = await load();
  const sums = totals(jobs);
  const engine = walletAddresses().engine ?? null;
  const agentId = setupState.agentId;

  const arcReasons = [
    { icon: Zap, title: "USDC is the gas", body: "A worker paid in USDC can act on chain immediately. There is no second token to buy, and Accrue covers the very first fee." },
    { icon: BadgeCheck, title: "Final in under a second", body: "Arc's finality is deterministic: payment is final the moment the vote lands, with no confirmations to wait for." },
    { icon: ScrollText, title: "ERC-8183 jobs", body: "AccrueJobs implements Arc's job standard, so any ERC-8183 client, indexer or agent can read and act on Accrue jobs." },
    {
      icon: Bot,
      title: "ERC-8004 agent identity",
      body: agentId
        ? `The Proof Engine is agent #${agentId} on Arc's ERC-8004 identity registry, with its own wallet and agent card.`
        : "The Proof Engine registers on Arc's ERC-8004 identity registry, with its own wallet and agent card.",
    },
    { icon: Signature, title: "Permit, so one transaction", body: "Arc's USDC supports EIP-2612 permits: posting and funding a job takes one signature and one transaction." },
  ];

  return (
    <div className="space-y-20">
      <section className="grid items-start gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="pt-2 rise">
          <div className="eyebrow">Outcome marketplace · Live on Arc mainnet</div>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-[3.4rem]">
            Pay for work when it&apos;s <span className="text-accent-bright">proven done.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-dim">
            Post an objective with a USDC budget. It stays locked on Arc until a panel verifies the delivery: Accrue&apos;s Proof Engine agent, the
            people you name, or both. Then the worker is paid in under a second, and even the network fee is paid in USDC.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/post" size="lg">
              Post a job <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="/jobs" size="lg" variant="secondary">
              Browse jobs
            </ButtonLink>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-faint">
            <span>ERC-8183 jobs</span>
            <span>ERC-8004 agent</span>
            <span>USDC gas</span>
            <span>Ownerless contracts</span>
            <span>Passkey accounts</span>
          </div>
        </div>
        <div className="rise" style={{ animationDelay: "80ms" }}>
          <LiveDemo />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Jobs on Accrue" value={<span className="num">{total}</span>} hint={deployed ? "Read live from Arc" : "Contracts deploying"} />
        <Stat label="Paid to workers" value={<Usdc value={sums.paid} />} hint="Completed jobs" />
        <Stat label="In escrow now" value={<Usdc value={sums.escrowed} />} hint="Funded, not yet decided" />
        <Stat label="Settled" value={<span className="num">{sums.settledCount}</span>} hint="Paid or refunded, by rule" />
      </section>

      <section>
        <div className="eyebrow">How it works</div>
        <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Three steps, all on chain</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-5">
              <div className="num grid size-8 place-items-center rounded-full bg-accent-soft text-sm text-accent-bright">{i + 1}</div>
              <h3 className="mt-4 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dim">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow">Rules nobody can bend</div>
        <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Fair to both sides, enforced by the contract</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-5">
              <Icon className="size-5 text-accent-bright" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-dim">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-line p-6 lg:border-b-0 lg:border-r sm:p-8">
            <div className="eyebrow">Why Arc</div>
            <h2 className="mt-2 text-2xl font-semibold">Built for Arc, not ported to it</h2>
            <p className="mt-3 text-sm leading-relaxed text-dim">
              Arc asks builders for <em>outcome marketplaces</em>: post an objective and a USDC bounty for agents or humans to deliver, with payment
              released on verification. That is Accrue, and Arc is the chain where it works best.
            </p>
            <div className="mt-5 space-y-2 text-sm">
              <a className="link block" href={explorer.address(CONTRACTS.jobs)} target="_blank" rel="noreferrer">AccrueJobs (ERC-8183) on the explorer →</a>
              <a className="link block" href={explorer.address(CONTRACTS.panel)} target="_blank" rel="noreferrer">AccruePanel (evaluator + hook) →</a>
              <a className="link block" href={explorer.address(ERC8004.identity)} target="_blank" rel="noreferrer">ERC-8004 identity registry →</a>
              <Link className="link block" href="/agents">Building an agent? Use Accrue from code →</Link>
            </div>
          </div>
          <div className="divide-y divide-line">
            {arcReasons.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 p-5 sm:px-8">
                <Icon className="mt-0.5 size-5 shrink-0 text-paid" />
                <div>
                  <div className="font-medium">{title}</div>
                  <p className="mt-1 text-sm text-dim">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow">On chain now</div>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Recent jobs</h2>
          </div>
          <Link href="/jobs" className="link text-sm">
            All jobs →
          </Link>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {jobs.slice(0, 6).map((job) => (
            <JobCard key={job.id} job={job} engine={engine} />
          ))}
          {jobs.length === 0 && (
            <div className="card p-6 text-sm text-dim md:col-span-2">
              {deployed ? "No jobs yet. Run the live demo above, or post the first one." : "The contracts are being deployed to Arc mainnet. Jobs appear here as soon as they exist."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
