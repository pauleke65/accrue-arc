"use client";
import { Bot, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { AddressLink, Badge, Notice, Section, TxLink, Usdc } from "@/components/ui";
import { useStatus } from "@/lib/client";
import { relative } from "@/lib/format";
import { NETWORK_NAME, chain } from "@/lib/arc";

const WALLET_LABELS = {
  ops: ["Operations", "Deploys the contracts, tops up the others, covers first fees. This is the wallet that bootstraps everything."],
  engine: ["Proof Engine", "Votes on jobs that name it, and settles, refunds and expires jobs as a public keeper."],
  demoA: ["Demo account A", "Client or worker in the live demo, taking turns with B."],
  demoB: ["Demo account B", "Client or worker in the live demo, taking turns with A."],
} as const;

function Ok({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-paid" /> : <CircleDashed className="size-4 text-faint" />}
      <span className={ok ? "" : "text-dim"}>{children}</span>
    </div>
  );
}

export default function StatusPage() {
  const { data, error } = useStatus(5_000);
  if (error && !data) return <div className="card p-8 text-center text-refund">{error}</div>;
  if (!data) return <div className="card p-8 text-center text-dim">Loading…</div>;
  const deployed = data.contracts.deployed.jobs && data.contracts.deployed.panel;
  const opsEmpty = data.wallets.ops && BigInt(data.wallets.ops.usdc) === 0n;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <div className="eyebrow brace">Transparency</div>
        <h1 className="mt-4 text-4xl sm:text-5xl">Deployment status</h1>
        <p className="mt-2 text-dim">Everything this server does on Arc, and with which wallets. No secrets are shown because none are needed to verify any of it.</p>
      </div>

      {data.seed !== "ok" && <Notice tone="refund">The server&apos;s key seed is {data.seed}. Set ACCRUE_KEY_SEED to 64 hex characters.</Notice>}
      {!deployed && opsEmpty && (
        <Notice tone="wait">
          Waiting for the first USDC. Send a few USDC on {NETWORK_NAME} to the operations wallet below; the server then deploys the contracts, funds the
          Proof Engine and demo accounts, and registers the Proof Engine on ERC-8004 by itself.
        </Notice>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Section eyebrow={`${NETWORK_NAME} · chain ${chain.id}`} title="Setup">
          <div className="space-y-2.5">
            <Ok ok={data.contracts.deployed.jobs}>AccrueJobs deployed</Ok>
            <Ok ok={data.contracts.deployed.panel}>AccruePanel deployed</Ok>
            <Ok ok={!!data.erc8004.agentId}>Proof Engine registered on ERC-8004{data.erc8004.agentId ? ` as agent #${data.erc8004.agentId}` : ""}</Ok>
            <Ok ok={data.ai.configured}>{data.ai.configured ? `Model judgement on (${data.ai.model})` : "Model judgement off: the engine decides on facts alone"}</Ok>
            <Ok ok={data.demo.ok}>Live demo {data.demo.ok ? "ready" : `unavailable${data.demo.reason ? `: ${data.demo.reason}` : ""}`}</Ok>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between gap-3"><span className="text-dim">AccrueJobs</span><AddressLink address={data.contracts.jobs} /></div>
            <div className="flex justify-between gap-3"><span className="text-dim">AccruePanel</span><AddressLink address={data.contracts.panel} /></div>
            <div className="flex justify-between gap-3"><span className="text-dim">ERC-8004 identity</span><AddressLink address={data.erc8004.identity} /></div>
          </div>
          {data.setup.lastError && <p className="mt-3 text-xs text-refund">Last setup error: {data.setup.lastError}</p>}
        </Section>

        <Section eyebrow="Agent" title="Proof Engine">
          <div className="flex items-center gap-2 text-sm">
            <Bot className="size-4 text-accent" /> Watching {data.engine.watching} open job{data.engine.watching === 1 ? "" : "s"}
            {data.engine.lastTick && <span className="text-faint">· checked {relative(data.engine.lastTick)}</span>}
          </div>
          <ul className="mt-3 space-y-2">
            {data.engine.votes.length === 0 && <li className="text-sm text-dim">No votes since this server started.</li>}
            {data.engine.votes.map((v) => (
              <li key={v.tx} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  {v.verdict === "pass" ? <CheckCircle2 className="size-4 text-paid" /> : <XCircle className="size-4 text-refund" />}
                  <a href={`/jobs/${v.jobId}`} className="link">Job #{v.jobId}</a>
                  <Badge tone={v.verdict === "pass" ? "paid" : "refund"}>{v.verdict}</Badge>
                </span>
                <TxLink hash={v.tx} />
              </li>
            ))}
          </ul>
          {data.engine.lastError && <p className="mt-3 text-xs text-refund">Last engine error: {data.engine.lastError}</p>}
        </Section>
      </div>

      <Section eyebrow="Server wallets" title="Who pays for what">
        <div className="divide-y divide-line">
          {(Object.keys(WALLET_LABELS) as (keyof typeof WALLET_LABELS)[]).map((name) => {
            const wallet = data.wallets[name];
            return (
              <div key={name} className="flex flex-wrap items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0 max-w-md">
                  <div className="font-medium">{WALLET_LABELS[name][0]}</div>
                  <div className="mt-0.5 text-xs text-dim">{WALLET_LABELS[name][1]}</div>
                  {wallet && <div className="mt-1.5"><AddressLink address={wallet.address} /></div>}
                </div>
                {wallet && <Usdc value={wallet.usdc} className="font-semibold" />}
              </div>
            );
          })}
        </div>
      </Section>

      {data.setup.log.length > 0 && (
        <Section eyebrow="Log" title="What setup did">
          <ul className="space-y-2 text-sm">
            {data.setup.log.map((entry) => (
              <li key={`${entry.at}-${entry.message}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>{entry.message}</span>
                <span className="flex items-center gap-3 text-xs text-faint">
                  {relative(entry.at)}
                  {entry.tx && <TxLink hash={entry.tx} />}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
