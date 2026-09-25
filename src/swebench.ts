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
import type { PolicyThresholds, SwebenchConfig } from "./config.ts";
import { ensureDir, readJsonl, TIERS, tierIndex, writeJson, writeJsonl, type Paths, type Tier } from "./data.ts";
import { makeDecider } from "./decider.ts";
import { decide } from "./policy.ts";
import { runPool } from "./pool.ts";
import { rng } from "./split.ts";
import { fmt, type Count } from "./metrics.ts";

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

export async function loadResolved(sub: string): Promise<Set<string>> {
  const dir = join(CACHE, "results");
  ensureDir(dir);
  const file = join(dir, `${sub}.json`);
  if (!existsSync(file)) {
    const json = await getJson(RESULTS(sub)).catch((e: Error) => {
      throw new Error(`${sub}: no results/results.json in SWE-bench/experiments (${e.message}). Pick a submission that has one.`);
    });
    writeFileSync(file, JSON.stringify(json));
  }
  return new Set(ResultsSchema.parse(JSON.parse(readFileSync(file, "utf8"))).resolved);
}

/** Lowest tier where ANY listed submission resolved the instance; null if none did. */
export function cheapestResolvingTier(id: string, resolvedByTier: Record<Tier, Set<string>[]>): Tier | null {
  for (const t of TIERS) if (resolvedByTier[t].some((s) => s.has(id))) return t;
  return null;
}

export async function runSwebench(p: Paths, cfg: SwebenchConfig, policy: PolicyThresholds, o: { concurrency: number; limit?: number }) {
  if (TIERS.some((t) => cfg.tiers[t].length === 0))
    throw new Error("config/swebench.json: list at least one submission per tier under `tiers` (Track B is skipped until then).");

  const resolvedByTier = Object.fromEntries(
    await Promise.all(TIERS.map(async (t) => [t, await Promise.all(cfg.tiers[t].map(loadResolved))] as const)),
  ) as Record<Tier, Set<string>[]>;
  const all = await loadInstances();

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
    return { id: inst.instance_id, jev: d.tier, reason: d.reason, model: r.model, difficulty: inst.difficulty, cheapest: cheapestResolvingTier(inst.instance_id, resolvedByTier) };
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
    submissions: cfg.tiers,
    models: [...new Set(rows.map((r) => r.model))],
  };
  writeJson(join(p.runsDir, "swebench_eval.json"), summary);
  console.log(`Solved by some tier: ${fmt({ k: n, n: rows.length })}. Among those, Jev under-routed ${fmt(summary.under)}.`);
  return summary;
}
