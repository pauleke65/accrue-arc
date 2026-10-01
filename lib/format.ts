import { USDC } from "./arc";

const SCALE = 10n ** BigInt(USDC.decimals);

/** Parses "12.5" into USDC base units without floating point. */
export function parseUsdc(input: string): bigint {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Enter an amount like 12.50");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > USDC.decimals) throw new Error("USDC has six decimal places");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(USDC.decimals, "0") || "0");
}

/** Formats USDC base units, exact, with at least two decimals. */
export function formatUsdc(value: bigint, maxDecimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / SCALE).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fraction = (abs % SCALE).toString().padStart(USDC.decimals, "0").slice(0, Math.max(2, maxDecimals));
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Native USDC (18 decimals) to a short dollar string, for network fees. */
export function formatFee(wei: bigint): string {
  const micro = Number(wei / 10n ** 12n); // millionths of a dollar
  if (micro === 0) return "<$0.000001";
  if (micro < 10_000) return `$${(micro / 1e6).toFixed(micro < 100 ? 6 : 4)}`;
  return `$${(micro / 1e6).toFixed(3)}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const UNITS: [number, string][] = [
  [86400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/** Current Unix time in seconds, for event handlers. */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** "3 hours", "1 day" — the largest unit that fits. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  for (const [size, unit] of UNITS) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${unit}${n === 1 ? "" : "s"}`;
    }
  }
  return "0 seconds";
}

export function relative(timestamp: number, now = Date.now() / 1000): string {
  const delta = timestamp - now;
  return delta >= 0 ? `in ${duration(delta)}` : `${duration(-delta)} ago`;
}

export function dateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
