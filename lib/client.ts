"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobDetail, JobView } from "./jobs";

/** Fetches JSON and re-fetches on an interval while the tab is visible. */
export function usePoll<T>(url: string | null, intervalMs: number): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      if (alive.current) {
        setData(body as T);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(reload, 0);
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void reload();
        }, intervalMs)
      : null;
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [reload, intervalMs]);

  return { data, error, reload };
}

export type StatusResponse = {
  chainId: number;
  contracts: { jobs: string; panel: string; deployed: { jobs: boolean; panel: boolean } };
  erc8004: { identity: string; reputation: string; validation: string; agentId: string | null; agentCard: string | null };
  seed: "ok" | "missing" | "invalid";
  wallets: Partial<Record<"ops" | "engine" | "demoA" | "demoB", { address: string; usdc: string }>>;
  ai: { configured: boolean; model: string | null };
  demo: { ok: boolean; reason?: string };
  setup: { lastRun: number | null; lastError: string | null; log: { at: number; message: string; tx?: string }[] };
  engine: { lastTick: number | null; lastError: string | null; watching: number; votes: { jobId: number; verdict: string; tx: string; at: number }[] };
};

export type JobsResponse = {
  total: number;
  jobs: JobView[];
  totals: { paid: string; escrowed: string; refunded: string; settledCount: number } | null;
  deployed: boolean;
};

export const useStatus = (intervalMs = 0) => usePoll<StatusResponse>("/api/status", intervalMs);
export const useJobs = (intervalMs = 8_000) => usePoll<JobsResponse>("/api/jobs?limit=200", intervalMs);
export const useJob = (id: number, intervalMs = 4_000) => usePoll<JobDetail>(`/api/jobs/${id}`, intervalMs);
