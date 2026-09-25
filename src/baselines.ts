/**
 * Baseline routers. Same output shape as the Jev router (runs/<name>.jsonl).
 *   length           prompt-length cutoffs, tuned on the TUNE set only (same rule as Jev)
 *   keywords         fixed keyword rules
 *   always_standard  reference point
 *   always_frontier  reference point (relative cost 1.0 by definition)
 *   llm              zero-shot cheap Claude classifier (only with --with-llm)
 */
import type { ThresholdsFile, FilledCosts } from "./config.ts";
import { loadLabels, loadTasks, routesPath, writeJson, writeJsonl, type Paths, type Route, type Task, type Tier } from "./data.ts";
import { computeMetrics, pairUp, selectBest } from "./metrics.ts";
import { runPool } from "./pool.ts";
import { loadSplit } from "./split.ts";
import { join } from "node:path";

export const BASELINES = ["length", "keywords", "always_standard", "always_frontier"] as const;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function lengthRoute(prompt: string, [short, long]: readonly [number, number]): { tier: Tier; reason: string } {
  const n = prompt.length;
  if (n < short) return { tier: "cheap", reason: `length ${n} < ${short}` };
  if (n < long) return { tier: "standard", reason: `length ${n} < ${long}` };
  return { tier: "frontier", reason: `length ${n} >= ${long}` };
}

const FRONTIER_KW =
  /\b(auth\w*|login|oauth|jwt|password|permission|payment|billing|stripe|invoice|security|vulnerab\w*|encrypt\w*|secret|migration|migrate|schema|terraform|kubernetes|k8s|helm|deploy\w*|ci\/cd|pipeline|infra\w*|delete|drop|truncate|wipe|purge|force[- ]push|rebase|rewrite history|architect\w*|design|redesign|why|investigate|flaky|intermittent|race condition|memory leak|slow|performance|across the codebase|everywhere)\b/i;
const CHEAP_KW =
  /\b(typo|spelling|rename|readme|docs?|documentation|comment|docstring|changelog|bump|version|format\w*|lint|indent\w*|whitespace|copy change|wording)\b/i;

export function keywordRoute(prompt: string): { tier: Tier; reason: string } {
  const f = prompt.match(FRONTIER_KW);
  if (f) return { tier: "frontier", reason: `keyword "${f[0]}"` };
  const c = prompt.match(CHEAP_KW);
  if (c) return { tier: "cheap", reason: `keyword "${c[0]}"` };
  return { tier: "standard", reason: "no keyword matched" };
}

// ---------------------------------------------------------------------------
// Length tuning (TUNE set only)
// ---------------------------------------------------------------------------

export function tuneLength(
  tasks: readonly Task[],
  labels: Parameters<typeof pairUp>[2],
  tuneIds: readonly string[],
  cutoffs: readonly number[],
  cap: number,
  costs: FilledCosts | null,
) {
  const cands = [];
  for (const a of cutoffs)
    for (const b of cutoffs) {
      if (b <= a) continue;
      const routes = new Map(tasks.map((t) => [t.id, { tier: lengthRoute(t.prompt, [a, b]).tier, confidence: null }]));
      const { pairs } = pairUp(tuneIds, routes, labels);
      cands.push({ cutoffs: [a, b] as [number, number], metrics: computeMetrics(pairs, costs) });
    }
  return selectBest(cands, cap);
}

// ---------------------------------------------------------------------------

const row = (id: string, router: string, r: { tier: Tier; reason: string }): Route => ({
  id,
  router,
  tier: r.tier,
  reason: r.reason,
  confidence: null,
  model: null,
});

export interface BaselineOptions {
  withLlm: boolean;
  concurrency: number;
  limit?: number;
}

export async function runBaselines(p: Paths, th: ThresholdsFile, costs: FilledCosts | null, o: BaselineOptions) {
  const tasks = loadTasks(p).slice(0, o.limit ?? Infinity);
  const labels = loadLabels(p, tasks);
  const split = loadSplit(p);

  const best = tuneLength(tasks, labels, split.tune, th.sweep.length_cutoffs, th.sweep.max_under_routing, costs);
  console.log(`length baseline: cutoffs ${best.cutoffs.join("/")} chars (tuned on ${best.metrics.n} tune tasks)`);
  writeJson(join(p.runsDir, "baselines_meta.json"), { length_cutoffs: best.cutoffs, tuned_on: "tune", n: best.metrics.n });

  const write = (name: string, rows: Route[]) => {
    writeJsonl(routesPath(p, name), rows);
    console.log(`Wrote ${rows.length} route(s) to ${routesPath(p, name)}`);
  };
  write("length", tasks.map((t) => row(t.id, "length", lengthRoute(t.prompt, best.cutoffs))));
  write("keywords", tasks.map((t) => row(t.id, "keywords", keywordRoute(t.prompt))));
  write("always_standard", tasks.map((t) => row(t.id, "always_standard", { tier: "standard", reason: "constant" })));
  write("always_frontier", tasks.map((t) => row(t.id, "always_frontier", { tier: "frontier", reason: "constant" })));

  if (o.withLlm) {
    const { classifyTier, CHEAP_LLM_MODEL } = await import("./llm.ts");
    console.log(`llm baseline: ${CHEAP_LLM_MODEL}, concurrency=${o.concurrency}`);
    const res = await runPool(tasks, o.concurrency, async (t) => {
      const r = await classifyTier(t.prompt, CHEAP_LLM_MODEL, false);
      return { ...row(t.id, "llm", { tier: r.tier, reason: r.reason }), model: r.model, cached: r.cached };
    });
    const rows = res.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length) {
      console.error(`llm baseline: ${failed.length} task(s) failed, e.g. ${(failed[0]!.reason as Error).message}`);
      process.exitCode = 1;
    }
    write("llm", rows);
  }
}
