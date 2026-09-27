/** Pure evaluation metrics. No I/O. */
import type { FilledCosts } from "./config.ts";
import { TIERS, tierIndex, type Label, type Tier } from "./data.ts";

export interface Pair {
  id: string;
  routed: Tier;
  label: Tier;
  sure: "yes" | "no";
  confidence: number | null;
}

export interface Count {
  k: number;
  n: number;
}

/** "4/60 (6.7%)". Every percentage in the report goes through this. */
export const fmt = ({ k, n }: Count): string => (n === 0 ? "0/0 (n/a)" : `${k}/${n} (${((100 * k) / n).toFixed(1)}%)`);

/** Wilson score 95% interval for k/n. */
export function wilson({ k, n }: Count, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export const fmtCI = (c: Count): string => {
  const [lo, hi] = wilson(c);
  return c.n === 0 ? "" : `[${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}%]`;
};

export type Confusion = Record<Tier, Record<Tier, number>>; // [label][routed]

export interface Metrics {
  n: number;
  distribution: Record<Tier, Count>;
  correct: Count;
  under: Count;
  over: Count;
  confusion: Confusion;
  sureNo: { correct: Count; under: Count };
  /** Average tier rank (cheap=0 .. frontier=2): a price-free proxy for spend. */
  meanTierRank: number;
  relativeCost: number | null;
}

export function pairUp(
  ids: readonly string[],
  routes: Map<string, { tier: Tier; confidence: number | null }>,
  labels: Map<string, Label>,
): { pairs: Pair[]; missing: string[] } {
  const pairs: Pair[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const r = routes.get(id);
    const l = labels.get(id);
    if (!r || !l) {
      missing.push(id);
      continue;
    }
    pairs.push({ id, routed: r.tier, label: l.label, sure: l.sure, confidence: r.confidence });
  }
  return { pairs, missing };
}

/**
 * Relative cost vs. sending everything to frontier.
 * Each task costs its routed tier; an under-routed task additionally costs a re-run at the
 * labeled tier (optimistic: assumes the failure is noticed). Plus router overhead per task.
 */
export function relativeCost(pairs: readonly Pair[], c: FilledCosts): number {
  if (!pairs.length) return NaN;
  let total = 0;
  for (const p of pairs) {
    total += c[p.routed] + c.router_overhead;
    if (tierIndex(p.routed) < tierIndex(p.label)) total += c[p.label];
  }
  return total / (pairs.length * c.frontier);
}

export function computeMetrics(pairs: readonly Pair[], costs: FilledCosts | null): Metrics {
  const n = pairs.length;
  const zero = () => Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const confusion = Object.fromEntries(TIERS.map((t) => [t, zero()])) as Confusion;
  const dist = zero();
  let correct = 0,
    under = 0,
    over = 0,
    rank = 0;
  const sn = { n: 0, correct: 0, under: 0 };
  for (const p of pairs) {
    const d = tierIndex(p.routed) - tierIndex(p.label);
    confusion[p.label][p.routed]++;
    dist[p.routed]++;
    rank += tierIndex(p.routed);
    if (d === 0) correct++;
    else if (d < 0) under++;
    else over++;
    if (p.sure === "no") {
      sn.n++;
      if (d === 0) sn.correct++;
      if (d < 0) sn.under++;
    }
  }
  return {
    n,
    distribution: Object.fromEntries(TIERS.map((t) => [t, { k: dist[t], n }])) as Record<Tier, Count>,
    correct: { k: correct, n },
    under: { k: under, n },
    over: { k: over, n },
    confusion,
    sureNo: { correct: { k: sn.correct, n: sn.n }, under: { k: sn.under, n: sn.n } },
    meanTierRank: n ? rank / n : NaN,
    relativeCost: costs ? relativeCost(pairs, costs) : null,
  };
}

export const CONFIDENCE_BUCKETS: readonly [number, number][] = [
  [0, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 1.0001],
];

export function accuracyByConfidence(pairs: readonly Pair[]) {
  return CONFIDENCE_BUCKETS.map(([lo, hi]) => {
    const inB = pairs.filter((p) => p.confidence !== null && p.confidence >= lo && p.confidence < hi);
    return {
      bucket: `${lo.toFixed(1)}–${Math.min(hi, 1).toFixed(1)}`,
      correct: { k: inB.filter((p) => p.routed === p.label).length, n: inB.length },
      under: { k: inB.filter((p) => tierIndex(p.routed) < tierIndex(p.label)).length, n: inB.length },
    };
  });
}

/** Spend measure used for tuning: relative cost if costs are filled in, else mean tier rank. */
export const spend = (m: Metrics): number => m.relativeCost ?? m.meanTierRank;

/**
 * Tuning rule (used for Jev thresholds AND the length baseline, so both get the same treatment):
 * among candidates with under-routing rate <= cap, take the lowest spend (ties: higher accuracy).
 * If none meet the cap, take the lowest under-routing rate.
 */
export function selectBest<T extends { metrics: Metrics }>(cands: readonly T[], cap: number): T {
  if (!cands.length) throw new Error("selectBest: no candidates");
  const rate = (c: Count) => (c.n ? c.k / c.n : 0);
  const ok = cands.filter((c) => rate(c.metrics.under) <= cap);
  const pool = ok.length ? ok : cands;
  return [...pool].sort((a, b) =>
    ok.length
      ? spend(a.metrics) - spend(b.metrics) || b.metrics.correct.k - a.metrics.correct.k
      : rate(a.metrics.under) - rate(b.metrics.under) || spend(a.metrics) - spend(b.metrics),
  )[0]!;
}

const quantile = (sorted: readonly number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : NaN;

export interface Overhead {
  calls: number;
  input_tokens: { mean: number; p50: number; max: number };
  latency_ms: { p50: number; p95: number; max: number };
  usd_per_1k_tasks: number;
}

/** Jev's own cost and latency, from real calls only (mock rows carry no usage). */
export function overhead(rows: readonly { usage?: { input_tokens: number }; latency_ms?: number }[], usdPerMtok: number): Overhead | null {
  const real = rows.filter((r) => r.usage && r.latency_ms !== undefined);
  if (!real.length) return null;
  const tok = real.map((r) => r.usage!.input_tokens).sort((a, b) => a - b);
  const lat = real.map((r) => r.latency_ms!).sort((a, b) => a - b);
  const mean = tok.reduce((a, b) => a + b, 0) / tok.length;
  return {
    calls: real.length,
    input_tokens: { mean, p50: quantile(tok, 0.5), max: tok.at(-1)! },
    latency_ms: { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), max: lat.at(-1)! },
    usd_per_1k_tasks: (mean * usdPerMtok * 1000) / 1e6,
  };
}
