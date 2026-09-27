/**
 * Track B: route SWE-bench Verified problem statements with Jev and compare against which
 * model tiers actually resolved each instance.
 *
 * Data (checked, not assumed):
 *  - SWE-bench/experiments: evaluation/verified/<submission>/results/results.json holds
 *    {"resolved": [instance_id...], "no_generation": [...], "no_logs": [...]}. Unresolved is
 *    implicit: every Verified instance not in "resolved". 135 of 182 Verified entries have it.
 *  - Problem statements + human `difficulty`: Hugging Face dataset SWE-bench/SWE-bench_Verified.
 * Caveats (also printed in the report): submissions differ in agent scaffold, one attempt each,
 * and GitHub issues are not agent prompts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { FilledCosts, PolicyThresholds, SwebenchConfig } from "./config.ts";
import { ensureDir, readJsonl, TIERS, tierIndex, writeJson, writeJsonl, type Paths, type Tier } from "./data.ts";
import { makeDecider } from "./decider.ts";
import { decide, type JevAnswers } from "./policy.ts";
import { runPool } from "./pool.ts";
import { rng } from "./split.ts";
import { computeMetrics, fmt, overhead, type Count, type Pair } from "./metrics.ts";
import { JEV_USD_PER_MTOK_INPUT } from "./questions.ts";

const CACHE = "data/swebench";
const HF = "https://datasets-server.huggingface.co/rows?dataset=SWE-bench%2FSWE-bench_Verified&config=default&split=test";
const RESULTS = (sub: string) =>
  `https://raw.githubusercontent.com/SWE-bench/experiments/main/evaluation/verified/${encodeURIComponent(sub)}/results/results.json`;

const InstanceSchema = z.object({ instance_id: z.string(), problem_statement: z.string(), difficulty: z.string().nullable() });
type Instance = z.infer<typeof InstanceSchema>;
const ResultsSchema = z.object({ resolved: z.array(z.string()) }).loose();

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

export async function loadInstances(): Promise<Instance[]> {
  const file = join(CACHE, "verified.jsonl");
  if (existsSync(file)) return readJsonl(file, InstanceSchema);
  const out: Instance[] = [];
  const Page = z.object({ num_rows_total: z.number(), rows: z.array(z.object({ row: z.unknown(), truncated_cells: z.array(z.string()) })) });
  for (let offset = 0; ; offset += 100) {
    const page = Page.parse(await getJson(`${HF}&offset=${offset}&length=100`));
    for (const r of page.rows) {
      if (r.truncated_cells.includes("problem_statement")) throw new Error("HF returned a truncated problem_statement");
      out.push(InstanceSchema.parse(r.row));
    }
    if (offset + 100 >= page.num_rows_total) break;
  }
  writeJsonl(file, out);
  return out;
}

const S3 = "https://swe-bench-submissions.s3.amazonaws.com/";
const METADATA = (sub: string) =>
  `https://raw.githubusercontent.com/SWE-bench/experiments/main/evaluation/verified/${encodeURIComponent(sub)}/metadata.yaml`;
const SubmissionCacheSchema = z
  .object({ resolved: z.array(z.string()), source: z.string().optional(), instance_cost: z.record(z.string(), z.number()).optional() })
  .loose();

export interface SubmissionResults {
  resolved: Set<string>;
  /** Measured USD per instance (only where the trajectories record it). */
  cost: Map<string, number> | null;
  source: string;
}

/** Fetch the first bytes of an S3 object; null on 404/403 (missing = no submission for that instance). */
async function s3Head(key: string, bytes = 400): Promise<string | null> {
  const r = await fetch(S3 + key, { headers: { Range: `bytes=0-${bytes}` } });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`GET ${S3 + key} -> ${r.status}`);
  return r.text();
}

/**
 * Per-instance results for one submission. Uses results/results.json from SWE-bench/experiments
 * when present; otherwise reads the public S3 logs named in metadata.yaml (per-instance
 * report.json, plus instance_cost from mini-SWE-agent trajectories). A missing report counts as
 * unresolved. Cached under data/swebench/results/.
 */
export async function loadSubmission(sub: string, instanceIds: readonly string[]): Promise<SubmissionResults> {
  const dir = join(CACHE, "results");
  ensureDir(dir);
  const file = join(dir, `${sub}.json`);
  if (!existsSync(file)) {
    const repo = await fetch(RESULTS(sub));
    if (repo.ok) writeFileSync(file, JSON.stringify({ ...((await repo.json()) as object), source: "results.json" }));
    else {
      const meta = await fetch(METADATA(sub)).then((r) => (r.ok ? r.text() : ""));
      const prefix = meta.match(/s3:\/\/swe-bench-submissions\/(\S+?)\/(?:trajs|logs)\b/)?.[1];
      if (!prefix) throw new Error(`${sub}: no results/results.json and no public S3 logs in metadata.yaml`);
      const rows = await runPool(instanceIds, 16, async (id) => {
        const rep = await s3Head(`${prefix}/logs/${id}/report.json`);
        const traj = await s3Head(`${prefix}/trajs/${id}/${id}.traj.json`);
        const cost = traj?.match(/"instance_cost":\s*([0-9.eE+-]+)/)?.[1];
        return { id, resolved: !!rep && /"resolved":\s*true/.test(rep), cost: cost === undefined ? null : Number(cost) };
      });
      const ok = rows.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length !== instanceIds.length) throw new Error(`${sub}: ${instanceIds.length - ok.length} S3 fetches failed`);
      const costs = ok.filter((r) => r.cost !== null);
      writeFileSync(
        file,
        JSON.stringify({
          resolved: ok.filter((r) => r.resolved).map((r) => r.id),
          source: `s3://swe-bench-submissions/${prefix}`,
          ...(costs.length ? { instance_cost: Object.fromEntries(costs.map((r) => [r.id, r.cost])) } : {}),
        }),
      );
    }
  }
  const c = SubmissionCacheSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  return {
    resolved: new Set(c.resolved),
    cost: c.instance_cost ? new Map(Object.entries(c.instance_cost)) : null,
    source: c.source ?? "results.json",
  };
}

/** Lowest tier where ANY listed submission resolved the instance; null if none did. */
export function cheapestResolvingTier(id: string, resolvedByTier: Record<Tier, Set<string>[]>): Tier | null {
  for (const t of TIERS) if (resolvedByTier[t].some((s) => s.has(id))) return t;
  return null;
}

/** Uncertainty rules compared on the same Jev answers: the configured one plus alternatives. */
export const RULE_VARIANTS = [0, 0.7, 0.8, 0.9] as const;
export const ruleName = (c: number) => (c ? `credible set ${c}` : "confidence round-up");

/**
 * Score each uncertainty rule against the cheapest tier that actually resolved each instance
 * (unsolved instances excluded). All other thresholds stay as configured.
 */
export function compareRules(
  rows: readonly { id: string; answers: JevAnswers; cheapest: Tier | null }[],
  policy: PolicyThresholds,
  costs: FilledCosts | null,
) {
  const solved = rows.filter((r) => r.cheapest !== null);
  return RULE_VARIANTS.map((c) => {
    const t = { ...policy, mass_coverage: c };
    const pairs: Pair[] = solved.map((r) => ({ id: r.id, routed: decide(r.answers, t).tier, label: r.cheapest!, sure: "yes", confidence: null }));
    const m = computeMetrics(pairs, costs);
    return { rule: ruleName(c), mass_coverage: c, under: m.under, exact: m.correct, over: m.over, distribution: m.distribution, mean_tier_rank: m.meanTierRank, relative_cost: m.relativeCost };
  });
}

export async function runSwebench(
  p: Paths,
  cfg: SwebenchConfig,
  policy: PolicyThresholds,
  costs: FilledCosts | null,
  o: { concurrency: number; limit?: number },
) {
  const ladder = cfg.ladders[0]!;
  if (TIERS.some((t) => ladder.tiers[t].submissions.length === 0))
    throw new Error("config/swebench.json: list at least one submission per tier in ladders[0] (Track B is skipped until then).");

  const all = await loadInstances();
  const ids = all.map((x) => x.instance_id);
  const resolvedByTier = Object.fromEntries(
    await Promise.all(
      TIERS.map(async (t) => [t, await Promise.all(ladder.tiers[t].submissions.map(async (s) => (await loadSubmission(s, ids)).resolved))] as const),
    ),
  ) as Record<Tier, Set<string>[]>;

  const rand = rng(cfg.seed);
  const sample = [...all]
    .sort((a, b) => a.instance_id.localeCompare(b.instance_id))
    .map((x) => ({ x, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, Math.min(cfg.sample, o.limit ?? Infinity))
    .map((s) => s.x);

  const decider = makeDecider(p.mockAnswers);
  console.log(`Track B: routing ${sample.length} SWE-bench Verified problem statements (DECIDER=${decider.kind})`);
  const res = await runPool(sample, o.concurrency, async (inst) => {
    const r = await decider.decide({ id: inst.instance_id, prompt: inst.problem_statement, source: "swebench" });
    const d = decide(r.answers, policy);
    return {
      id: inst.instance_id,
      jev: d.tier,
      reason: d.reason,
      model: r.model,
      difficulty: inst.difficulty,
      cheapest: cheapestResolvingTier(inst.instance_id, resolvedByTier),
      answers: r.answers,
      usage: r.usage,
      latency_ms: r.latency_ms,
    };
  });
  const rows = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = res.length - rows.length;
  if (failed) {
    console.error(`${failed} instance(s) failed to route.`);
    process.exitCode = 1;
  }
  writeJsonl(join(p.runsDir, "swebench.jsonl"), rows);

  const solved = rows.filter((r) => r.cheapest !== null);
  const n = solved.length;
  const c = (f: (r: (typeof solved)[number]) => boolean): Count => ({ k: solved.filter(f).length, n });
  const byDifficulty: Record<string, Record<Tier, number>> = {};
  for (const r of rows) {
    const key = r.difficulty ?? "unknown";
    byDifficulty[key] ??= { cheap: 0, standard: 0, frontier: 0 };
    byDifficulty[key][r.jev]++;
  }
  const summary = {
    sampled: rows.length,
    unsolved_by_any_tier: { k: rows.length - n, n: rows.length },
    under: c((r) => tierIndex(r.jev) < tierIndex(r.cheapest!)),
    exact: c((r) => r.jev === r.cheapest),
    over: c((r) => tierIndex(r.jev) > tierIndex(r.cheapest!)),
    cheapest_distribution: Object.fromEntries(TIERS.map((t) => [t, c((r) => r.cheapest === t)])),
    jev_tier_by_human_difficulty: byDifficulty,
    rules: compareRules(rows, policy, costs),
    overhead: overhead(rows, JEV_USD_PER_MTOK_INPUT),
    submissions: Object.fromEntries(TIERS.map((t) => [t, ladder.tiers[t].submissions])),
    models: [...new Set(rows.map((r) => r.model))],
  };
  writeJson(join(p.runsDir, "swebench_eval.json"), summary);
  console.log(`Solved by some tier: ${fmt({ k: n, n: rows.length })}. Among those, Jev under-routed ${fmt(summary.under)}.`);
  return summary;
}
