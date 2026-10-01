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
    <div className="space-y-24">
      <section className="hero sky bleed relative overflow-hidden">
        <LineArt />
        <div className="relative mx-auto grid max-w-6xl items-start gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr]">
          <div className="rise lg:pt-6">
            <div className="eyebrow brace !text-ink">Outcome marketplace on Arc</div>
            <h1 className="mt-6 text-[2.9rem] sm:text-[4.4rem]">Pay for work when it&apos;s proven done.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/85">
              Post an objective with a USDC budget. It stays locked on Arc until a panel verifies the delivery: Accrue&apos;s Proof Engine agent, the
              people you name, or both. Then the worker is paid in under a second, and even the network fee is paid in USDC.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/post" size="lg">
                Post a job <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="/jobs" size="lg" variant="secondary">
                Browse jobs
              </ButtonLink>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              {["ERC-8183 jobs", "ERC-8004 agent", "USDC gas", "No admin keys", "Passkeys"].map((tag) => (
                <span key={tag} className="eyebrow rounded-[4px] border border-accent/60 bg-white/40 px-2.5 py-1 !text-[0.66rem] !text-accent">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div id="demo" className="scroll-mt-28 rise" style={{ animationDelay: "80ms" }}>
            <LiveDemo />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Jobs on Accrue" value={<span className="num">{total}</span>} hint={deployed ? "Read live from Arc" : "Contracts deploying"} />
        <Stat label="Paid to workers" value={<Usdc value={sums.paid} />} hint="Completed jobs" />
        <Stat label="In escrow now" value={<Usdc value={sums.escrowed} />} hint="Funded, not yet decided" />
        <Stat label="Settled" value={<span className="num">{sums.settledCount}</span>} hint="Paid or refunded, by rule" />
      </section>

      <section>
        <div className="eyebrow brace">How it works</div>
        <h2 className="mt-4 text-4xl sm:text-5xl">Three steps, all on chain</h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <div className="eyebrow slashes border-b border-sky pb-3">Step.0{i + 1}</div>
              <h3 className="mt-5 text-2xl">{step.title}</h3>
              <p className="mt-3 leading-relaxed text-dim">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="eyebrow brace">Rules nobody can bend</div>
        <h2 className="mt-4 max-w-3xl text-4xl sm:text-5xl">Fair to both sides, enforced by the contract</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="ticks -ml-px -mt-px p-7">
              <Icon className="size-7 text-amber" strokeWidth={1.5} />
              <h3 className="mt-5 text-2xl">{title}</h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-dim">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bleed relative overflow-hidden bg-sand">
        <LineArt tone="sand" />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="eyebrow brace">Why Arc</div>
            <h2 className="mt-4 text-4xl sm:text-5xl">Built for Arc, not ported to it</h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/85">
              Arc asks builders for <em>outcome marketplaces</em>: post an objective and a USDC bounty for agents or humans to deliver, with payment
              released on verification. That is Accrue, and Arc is the chain where it works best.
            </p>
            <div className="mt-8 space-y-2.5">
              <a className="flex items-center gap-2 text-ink hover:underline" href={explorer.address(CONTRACTS.jobs)} target="_blank" rel="noreferrer">AccrueJobs (ERC-8183) on the explorer <ArrowRight className="size-4" /></a>
              <a className="flex items-center gap-2 text-ink hover:underline" href={explorer.address(CONTRACTS.panel)} target="_blank" rel="noreferrer">AccruePanel (evaluator + hook) <ArrowRight className="size-4" /></a>
              <a className="flex items-center gap-2 text-ink hover:underline" href={explorer.address(ERC8004.identity)} target="_blank" rel="noreferrer">ERC-8004 identity registry <ArrowRight className="size-4" /></a>
              <Link className="flex items-center gap-2 text-ink hover:underline" href="/agents">Building an agent? Use Accrue from code <ArrowRight className="size-4" /></Link>
            </div>
          </div>
          <div className="divide-y divide-ink/10 rounded-[6px] bg-white/70 backdrop-blur-sm">
            {arcReasons.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 p-5 sm:px-7">
                <Icon className="mt-1 size-5 shrink-0 text-amber" strokeWidth={1.75} />
                <div>
                  <h3 className="text-lg">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-dim">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow brace">On chain now</div>
            <h2 className="mt-4 text-4xl sm:text-5xl">Recent jobs</h2>
          </div>
          <Link href="/jobs" className="flex items-center gap-1.5 text-sm text-ink hover:underline">
            All jobs <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {jobs.slice(0, 6).map((job) => (
            <JobCard key={job.id} job={job} engine={engine} />
          ))}
          {jobs.length === 0 && (
            <div className="ticks p-7 text-dim md:col-span-2">
              {deployed ? "No jobs yet. Run the live demo above, or post the first one." : "The contracts are being deployed to Arc mainnet. Jobs appear here as soon as they exist."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Thin white arcs and nodes, the line art behind arc.io's hero. */
function LineArt({ tone = "sky" }: { tone?: "sky" | "sand" }) {
  const stroke = tone === "sky" ? "rgb(255 255 255 / 0.85)" : "rgb(255 255 255 / 0.7)";
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g fill="none" stroke={stroke} strokeWidth="1.5">
        <path d="M-40 380C180 360 380 240 450 -20" />
        <path d="M-20 360 320 650V820" />
        <path d="M0 716H1440" />
        <path d="M960 820C1000 600 1180 410 1480 395" />
        <circle cx="1240" cy="140" r="190" opacity="0.55" />
      </g>
      <g fill={stroke}>
        <circle cx="74" cy="381" r="5" />
        <circle cx="274" cy="716" r="5" />
        <circle cx="1165" cy="490" r="5" />
        <circle cx="1052" cy="327" r="4" />
      </g>
    </svg>
  );
}
