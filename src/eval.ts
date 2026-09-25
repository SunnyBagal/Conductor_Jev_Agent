/**
 * eval: score every router on the TUNE set (default) or the TEST set (--final only).
 * Every --final run appends timestamp + git commit + router config hash to test_runs.log.
 * Jev routes are re-derived from stored answers with the CURRENT thresholds, so the
 * config hash always matches what was scored.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { FilledCosts, ThresholdsFile } from "./config.ts";
import { ensureDir, loadLabels, loadRoutes, loadTasks, routesPath, writeJson, type Paths, type Route, type Tier } from "./data.ts";
import { isMockModel } from "./decider.ts";
import { accuracyByConfidence, computeMetrics, fmt, pairUp, type Metrics, type Pair } from "./metrics.ts";
import { TASK_BASE_TIER } from "./policy.ts";
import { JEV_MODEL, QUESTION_SET_VERSION, QUESTIONS } from "./questions.ts";
import { BASELINES } from "./baselines.ts";
import { loadSplit } from "./split.ts";
import { evalThresholds, loadJevAnswers } from "./sweep.ts";

export const ROUTERS = ["jev", ...BASELINES, "llm"] as const;

/** Hash of everything that determines Jev's routing: questions, model, policy code, thresholds. */
export function routerConfigHash(th: ThresholdsFile): string {
  const policySrc = readFileSync(fileURLToPath(new URL("./policy.ts", import.meta.url)), "utf8");
  return createHash("sha256")
    .update(JSON.stringify({ QUESTION_SET_VERSION, QUESTIONS, JEV_MODEL, TASK_BASE_TIER, policy: th.policy, policySrc }))
    .digest("hex")
    .slice(0, 16);
}

function gitCommit(): { sha: string; dirty: boolean } {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "config"], { encoding: "utf8" }).trim() !== "";
    return { sha, dirty };
  } catch {
    throw new Error("--final needs a git repository with at least one commit, so the test run can be traced to code.");
  }
}

export function testRunCount(p: Paths): number {
  if (!existsSync(p.testRunsLog)) return 0;
  return readFileSync(p.testRunsLog, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
}

export interface RouterResult {
  router: string;
  metrics: Metrics;
  missing: number;
  models: string[];
  buckets?: ReturnType<typeof accuracyByConfidence>;
  pairs: Pair[];
  routes: Route[];
}

export interface EvalResult {
  set: "tune" | "test";
  ids: number;
  mock: boolean;
  config_hash: string;
  test_runs: number;
  results: RouterResult[];
}

export function runEval(p: Paths, th: ThresholdsFile, costs: FilledCosts | null, final: boolean): EvalResult {
  const tasks = loadTasks(p);
  const labels = loadLabels(p, tasks);
  const split = loadSplit(p);
  const set = final ? "test" : "tune";
  const ids = final ? split.test : split.tune;
  const hash = routerConfigHash(th);

  const results: RouterResult[] = [];
  for (const router of ROUTERS) {
    if (!existsSync(routesPath(p, router))) continue;
    let routes = loadRoutes(p, router);
    if (router === "jev") {
      const fresh = evalThresholds(loadJevAnswers(p), th.policy);
      routes = routes.map((r) => ({ ...r, ...fresh.get(r.id)! }));
    }
    const byId = new Map<string, { tier: Tier; confidence: number | null }>(routes.map((r) => [r.id, r]));
    const { pairs, missing } = pairUp(ids, byId, labels);
    results.push({
      router,
      metrics: computeMetrics(pairs, costs),
      missing: missing.length,
      models: [...new Set(routes.map((r) => r.model).filter((m): m is string => !!m))],
      buckets: router === "jev" ? accuracyByConfidence(pairs) : undefined,
      pairs,
      routes: routes.filter((r) => ids.includes(r.id)),
    });
  }
  if (!results.some((r) => r.router === "jev")) throw new Error(`No Jev routes in ${routesPath(p, "jev")}. Run \`route\` first.`);

  if (final) {
    const g = gitCommit();
    if (g.dirty) console.warn("warning: src/ or config/ has uncommitted changes; the log marks this run as dirty.");
    ensureDir(p.reportsDir);
    const n = results.find((r) => r.router === "jev")!.metrics.n;
    appendFileSync(
      p.testRunsLog,
      `${new Date().toISOString()}\tcommit=${g.sha.slice(0, 12)}${g.dirty ? "-dirty" : ""}\tconfig=${hash}\tn=${n}\n`,
    );
  }

  const mock = results.find((r) => r.router === "jev")!.models.some(isMockModel);
  const out: EvalResult = { set, ids: ids.length, mock, config_hash: hash, test_runs: testRunCount(p), results };
  writeJson(join(p.runsDir, `eval_${set}.json`), out);
  printSummary(out);
  return out;
}

function printSummary(e: EvalResult) {
  console.log(`\nEval on ${e.set.toUpperCase()} set (${e.ids} ids)${e.mock ? "  [MOCK DECIDER: not real Jev results]" : ""}`);
  console.log(`router config hash ${e.config_hash}; test set evaluated ${e.test_runs} time(s)\n`);
  const rows = e.results.map((r) => [
    r.router,
    fmt(r.metrics.under),
    fmt(r.metrics.over),
    fmt(r.metrics.correct),
    r.metrics.relativeCost === null ? "fill costs.json" : r.metrics.relativeCost.toFixed(3),
  ]);
  const head = ["router", "under-routed", "over-routed", "exact", "rel. cost"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  for (const r of [head, ...rows]) console.log(r.map((c, i) => c.padEnd(w[i]!)).join("  "));
}

