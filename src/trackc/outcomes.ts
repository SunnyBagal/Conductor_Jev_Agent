/**
 * Track C outcomes: pure aggregation of attempt records, implementing the rules
 * pre-registered in docs/trackc_plan.md. No I/O.
 */
import { z } from "zod";

export const ATTEMPT_STATUS = ["pass", "fail", "refused", "fallback", "error"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[number];

export const AttemptSchema = z.object({
  task_id: z.string(),
  /** "casual" = rewritten prompt; "original" = control arm with the issue text. */
  arm: z.enum(["casual", "original"]),
  tier: z.string(),
  model_id: z.string(),
  attempt: z.number().int().min(1),
  status: z.enum(ATTEMPT_STATUS),
  /** Models that actually answered turns (fallback detection). */
  models_seen: z.array(z.string()).default([]),
  patch: z.string().default(""),
  /** PASS_TO_PASS results: the repo's existing tests picked by SWE-bench. null if the verifier didn't report them. */
  p2p: z.object({ passed: z.number().int(), failed: z.number().int() }).nullable().default(null),
  cost_usd: z.number().nullable().default(null),
  input_tokens: z.number().nullable().default(null),
  output_tokens: z.number().nullable().default(null),
  wall_s: z.number().nullable().default(null),
  /** The --fallback-model value used for this run. Must be null (flag never passed). */
  fallback_model: z.string().nullable().default(null),
  /** Where cost_usd came from: Claude Code's own total_cost_usd, a token-price estimate, or nothing. */
  cost_source: z.enum(["claude_code", "estimate", "none"]).default("none"),
  launch_command: z.string().optional(),
  error: z.string().optional(),
  harness_version: z.string().optional(),
  started_at: z.string(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const isValid = (a: Attempt) => a.status === "pass" || a.status === "fail";

// ---------------------------------------------------------------------------
// Per task x model
// ---------------------------------------------------------------------------

export interface Cell {
  valid: number;
  passes: number;
  refused: number;
  fallback: number;
  errors: number;
  /** null = undetermined (fewer than 2 valid attempts). */
  majority: boolean | null;
  all: boolean | null;
}

export function cell(attempts: readonly Attempt[]): Cell {
  const valid = attempts.filter(isValid);
  const passes = valid.filter((a) => a.status === "pass").length;
  const determined = valid.length >= 2;
  return {
    valid: valid.length,
    passes,
    refused: attempts.filter((a) => a.status === "refused").length,
    fallback: attempts.filter((a) => a.status === "fallback").length,
    errors: attempts.filter((a) => a.status === "error").length,
    majority: determined ? passes * 2 > valid.length : null,
    all: determined ? passes === valid.length : null,
  };
}

/** task -> tier -> Cell, for one arm. */
export function cells(attempts: readonly Attempt[], arm: Attempt["arm"] = "casual"): Map<string, Map<string, Cell>> {
  const groups = new Map<string, Map<string, Attempt[]>>();
  for (const a of attempts) {
    if (a.arm !== arm) continue;
    const byTier = groups.get(a.task_id) ?? new Map<string, Attempt[]>();
    byTier.set(a.tier, [...(byTier.get(a.tier) ?? []), a]);
    groups.set(a.task_id, byTier);
  }
  return new Map([...groups].map(([t, m]) => [t, new Map([...m].map(([tier, as]) => [tier, cell(as)]))]));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export interface Label {
  /** Cheapest tier (by price order) that passes, "unsolved", or "undetermined". */
  tier: string;
  /** A cheaper tier than the label was undetermined. */
  uncertain: boolean;
}

export function label(byTier: Map<string, Cell>, order: readonly string[], rule: "majority" | "all"): Label {
  let sawUndetermined = false;
  for (const t of order) {
    const v = byTier.get(t)?.[rule] ?? null;
    if (v === true) return { tier: t, uncertain: sawUndetermined };
    if (v === null) sawUndetermined = true;
  }
  return sawUndetermined ? { tier: "undetermined", uncertain: true } : { tier: "unsolved", uncertain: false };
}

// ---------------------------------------------------------------------------
// Per-model consistency report
// ---------------------------------------------------------------------------

export interface ModelReport {
  tier: string;
  tasks: number;
  majority: { k: number; n: number };
  all: { k: number; n: number };
  /** Pass-count distribution over tasks with exactly `attempts` valid attempts. */
  dist: number[];
  distN: number;
  /** PRIMARY consistency: tasks passed 3/3 among tasks passed at least once (full-attempt tasks only). */
  allGivenAny: { k: number; n: number };
  undetermined: number;
  refused: number;
  fallback: number;
  errors: number;
}

export function modelReport(all: Map<string, Map<string, Cell>>, tier: string, attempts: number): ModelReport {
  const cs = [...all.values()].flatMap((m) => (m.has(tier) ? [m.get(tier)!] : []));
  const det = cs.filter((c) => c.majority !== null);
  const full = cs.filter((c) => c.valid === attempts);
  const dist = Array.from({ length: attempts + 1 }, (_, k) => full.filter((c) => c.passes === k).length);
  return {
    tier,
    tasks: cs.length,
    majority: { k: det.filter((c) => c.majority).length, n: det.length },
    all: { k: det.filter((c) => c.all).length, n: det.length },
    dist,
    distN: full.length,
    allGivenAny: { k: dist[attempts]!, n: dist.slice(1).reduce((x, y) => x + y, 0) },
    undetermined: cs.length - det.length,
    refused: cs.reduce((s, c) => s + c.refused, 0),
    fallback: cs.reduce((s, c) => s + c.fallback, 0),
    errors: cs.reduce((s, c) => s + c.errors, 0),
  };
}

// ---------------------------------------------------------------------------
// Pre-registered H1: is `a` (Fable) more consistent than `b` (Opus)?
// ---------------------------------------------------------------------------

/** Exact two-sided binomial sign test p-value for k successes of n at p = 0.5. */
export function signTestP(k: number, n: number): number {
  if (n === 0) return 1;
  const pmf = (i: number) => Math.exp(lchoose(n, i) - n * Math.LN2);
  const obs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= obs * (1 + 1e-9)) p += pmf(i);
  return Math.min(1, p);
}
function lchoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** SECONDARY (original pre-registration): inconsistent = passed 1/3 or 2/3, on tasks with full attempts for both. */
export function inconsistencyTest(all: Map<string, Map<string, Cell>>, a: string, b: string, attempts: number, alpha = 0.05) {
  const incons = (c: Cell) => c.passes > 0 && c.passes < attempts;
  let n = 0, aOnlyConsistent = 0, bOnlyConsistent = 0, aIncons = 0, bIncons = 0;
  for (const m of all.values()) {
    const ca = m.get(a), cb = m.get(b);
    if (!ca || !cb || ca.valid !== attempts || cb.valid !== attempts) continue;
    n++;
    if (incons(ca)) aIncons++;
    if (incons(cb)) bIncons++;
    if (!incons(ca) && incons(cb)) aOnlyConsistent++;
    if (incons(ca) && !incons(cb)) bOnlyConsistent++;
  }
  const discordant = aOnlyConsistent + bOnlyConsistent;
  const p = signTestP(aOnlyConsistent, discordant);
  return { n, aIncons, bIncons, aOnlyConsistent, bOnlyConsistent, discordant, p, supported: p < alpha && aOnlyConsistent > bOnlyConsistent };
}

export type Verdict = "supported" | "not supported" | `inconclusive — ${number} discordant tasks`;

/**
 * PRIMARY paired test (amendment 1): tasks where both models have full attempts and each passed
 * at least once. Discordant = exactly one of them passed every attempt. Unweighted sign test.
 * Fewer than `minDiscordant` discordant tasks -> "inconclusive — N discordant tasks".
 */
export function consistencyTest(all: Map<string, Map<string, Cell>>, a: string, b: string, attempts: number, minDiscordant: number, alpha = 0.05) {
  let n = 0, aOnly = 0, bOnly = 0, both = 0;
  for (const m of all.values()) {
    const ca = m.get(a), cb = m.get(b);
    if (!ca || !cb || ca.valid !== attempts || cb.valid !== attempts || ca.passes === 0 || cb.passes === 0) continue;
    n++;
    const fa = ca.passes === attempts, fb = cb.passes === attempts;
    if (fa && fb) both++;
    else if (fa) aOnly++;
    else if (fb) bOnly++;
  }
  const discordant = aOnly + bOnly;
  const p = signTestP(aOnly, discordant);
  const verdict: Verdict =
    discordant < minDiscordant ? `inconclusive — ${discordant} discordant tasks` : p < alpha && aOnly > bOnly ? "supported" : "not supported";
  return { n, both, aOnly, bOnly, discordant, p, verdict };
}

// ---------------------------------------------------------------------------
// Cascade labeling (amendment 1)
// ---------------------------------------------------------------------------

/**
 * The attempts the cascade design would have run: cheapest tier everywhere; the next tier only
 * where the previous one passed fewer than `gate` times; the last two tiers (top and ceiling)
 * together, once the second tier falls short. Control-arm attempts are kept as-is.
 */
export function cascadePrune(attempts: readonly Attempt[], order: readonly string[], gate: number): Attempt[] {
  const [t0, t1, ...rest] = order;
  const passes = (task: string, tier: string) => attempts.filter((a) => a.arm === "casual" && a.task_id === task && a.tier === tier && a.status === "pass").length;
  return attempts.filter((a) => {
    if (a.arm !== "casual" || a.tier === t0) return true;
    const cheapShort = passes(a.task_id, t0!) < gate;
    if (a.tier === t1) return cheapShort;
    if (rest.includes(a.tier)) return cheapShort && passes(a.task_id, t1!) < gate;
    return false;
  });
}

/** Labels under the full grid vs the cascade-pruned grid. Should never differ; any row is a bug. */
export function cascadeLabelMismatches(attempts: readonly Attempt[], order: readonly string[], gate: number) {
  const full = cells(attempts);
  const pruned = cells(cascadePrune(attempts, order, gate));
  const out: { task: string; rule: "majority" | "all"; full: Label; cascade: Label }[] = [];
  for (const [task, byTier] of full)
    for (const rule of ["majority", "all"] as const) {
      const f = label(byTier, order, rule), c = label(pruned.get(task) ?? new Map(), order, rule);
      if (f.tier !== c.tier || f.uncertain !== c.uncertain) out.push({ task, rule, full: f, cascade: c });
    }
  return out;
}

// ---------------------------------------------------------------------------
// Spend and patch quality proxies
// ---------------------------------------------------------------------------

export function spendByTier(attempts: readonly Attempt[]) {
  const out = new Map<string, { usd: number; runs: number; missing: number }>();
  for (const a of attempts) {
    const key = `${a.arm}:${a.tier}`;
    const s = out.get(key) ?? { usd: 0, runs: 0, missing: 0 };
    s.runs++;
    if (a.cost_usd === null) s.missing++;
    else s.usd += a.cost_usd;
    out.set(key, s);
  }
  const total = [...out.values()].reduce((x, s) => x + s.usd, 0);
  return { byKey: out, total };
}

/** Lines added+removed and files touched in a unified diff (ignores the ---/+++ headers). */
export function patchStats(diff: string): { files: number; lines: number } {
  const files = new Set<string>();
  let lines = 0;
  for (const l of diff.split("\n")) {
    const m = l.match(/^diff --git a\/(\S+) b\//);
    if (m) files.add(m[1]!);
    else if ((l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---"))) lines++;
  }
  return { files: files.size, lines };
}

export const median = (xs: readonly number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function qualityByTier(attempts: readonly Attempt[], tier: string) {
  const mine = attempts.filter((a) => a.arm === "casual" && a.tier === tier && isValid(a));
  const passing = mine.filter((a) => a.status === "pass").map((a) => patchStats(a.patch));
  const failing = mine.filter((a) => a.status === "fail");
  const withP2p = failing.filter((a) => a.p2p !== null);
  return {
    passingPatches: passing.length,
    medianLines: median(passing.map((p) => p.lines)),
    medianFiles: median(passing.map((p) => p.files)),
    failingBrokeExistingTests: { k: withP2p.filter((a) => a.p2p!.failed > 0).length, n: withP2p.length },
  };
}
