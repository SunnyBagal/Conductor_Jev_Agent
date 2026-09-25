/**
 * Threshold sweep on the TUNE set only. Re-applies the pure policy to stored Jev answers
 * (runs/jev.jsonl), so it costs no API calls. Writes runs/sweep.json.
 */
import { join } from "node:path";
import type { FilledCosts, PolicyThresholds, ThresholdsFile } from "./config.ts";
import { loadLabels, loadRoutes, loadTasks, writeJson, type Paths, type Tier } from "./data.ts";
import { computeMetrics, pairUp, selectBest, spend, type Metrics } from "./metrics.ts";
import { decide, JevAnswersSchema, type JevAnswers } from "./policy.ts";
import { loadSplit } from "./split.ts";

export interface SweepPoint {
  params: PolicyThresholds;
  under_rate: number;
  spend: number;
  accuracy: number;
  metrics: Metrics;
}

/** Cartesian product of grid values layered over the base thresholds. */
export function expandGrid(base: PolicyThresholds, grid: Record<string, number[]>): PolicyThresholds[] {
  const keys = Object.keys(grid).filter((k) => k in base) as (keyof PolicyThresholds)[];
  const unknown = Object.keys(grid).filter((k) => !(k in base));
  if (unknown.length) throw new Error(`sweep.grid has unknown threshold(s): ${unknown.join(", ")}`);
  let out: PolicyThresholds[] = [{ ...base }];
  for (const k of keys) out = out.flatMap((p) => grid[k]!.map((v) => ({ ...p, [k]: v })));
  return out;
}

export function loadJevAnswers(p: Paths): Map<string, JevAnswers> {
  return new Map(loadRoutes(p, "jev").map((r) => [r.id, JevAnswersSchema.parse(r.answers)]));
}

export function evalThresholds(answers: Map<string, JevAnswers>, t: PolicyThresholds) {
  const routes = new Map<string, { tier: Tier; confidence: number | null }>();
  for (const [id, a] of answers) {
    const d = decide(a, t);
    routes.set(id, { tier: d.tier, confidence: d.confidence });
  }
  return routes;
}

/** Points not dominated on (under_rate, spend): the savings vs under-routing curve. */
export function pareto(points: readonly SweepPoint[]): SweepPoint[] {
  const sorted = [...points].sort((a, b) => a.spend - b.spend || a.under_rate - b.under_rate);
  const out: SweepPoint[] = [];
  let bestUnder = Infinity;
  for (const p of sorted)
    if (p.under_rate < bestUnder) {
      out.push(p);
      bestUnder = p.under_rate;
    }
  return out;
}

export function runSweep(p: Paths, th: ThresholdsFile, costs: FilledCosts | null) {
  const tasks = loadTasks(p);
  const labels = loadLabels(p, tasks);
  const split = loadSplit(p);
  const answers = loadJevAnswers(p);

  const grid = expandGrid(th.policy, th.sweep.grid);
  const points: SweepPoint[] = grid.map((params) => {
    const { pairs } = pairUp(split.tune, evalThresholds(answers, params), labels);
    const m = computeMetrics(pairs, costs);
    return { params, under_rate: m.n ? m.under.k / m.n : 0, spend: spend(m), accuracy: m.n ? m.correct.k / m.n : 0, metrics: m };
  });
  const best = selectBest(points, th.sweep.max_under_routing);
  const front = pareto(points);

  const out = {
    set: "tune",
    n: best.metrics.n,
    spend_measure: costs ? "relative_cost_vs_all_frontier" : "mean_tier_rank (fill config/costs.json for real cost)",
    max_under_routing: th.sweep.max_under_routing,
    grid_size: points.length,
    best: { params: best.params, under: best.metrics.under, correct: best.metrics.correct, spend: best.spend },
    pareto: front.map((q) => ({ params: q.params, under: q.metrics.under, correct: q.metrics.correct, spend: q.spend })),
  };
  writeJson(join(p.runsDir, "sweep.json"), out);
  console.log(`Sweep: ${points.length} settings on ${best.metrics.n} TUNE tasks, ${front.length} on the Pareto front.`);
  console.log(`Best (under-routing <= ${th.sweep.max_under_routing}): ${JSON.stringify(best.params)}`);
  console.log(`Copy these into config/thresholds.json "policy" if you accept them.`);
  return out;
}
