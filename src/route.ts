import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadTasks, routesPath, writeJsonl, type Paths, type Route } from "./data.ts";
import type { PolicyThresholds } from "./config.ts";
import { assertJevApproved, makeDecider, requestBody } from "./decider.ts";
import { decide } from "./policy.ts";
import { runPool } from "./pool.ts";

export interface RouteOptions {
  limit?: number;
  concurrency: number;
  dryRun: boolean;
  approveJev?: boolean;
}

/**
 * Track A rule: on the real dataset (data/), the split and labels must be committed to git before
 * any Jev routing, so the split provably could not have been chosen after seeing routes.
 */
export function assertSplitCommitted(p: Paths) {
  if (p.dataDir !== "data") return;
  const git = (...a: string[]) => execFileSync("git", a, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  for (const f of [p.split, p.labels]) {
    if (!existsSync(f)) throw new Error(`${f} is missing. Run \`split\` and commit it before routing.`);
    try {
      git("ls-files", "--error-unmatch", f);
    } catch {
      throw new Error(`${f} is not committed. Commit it before any Jev routing (git add ${f} && git commit).`);
    }
    if (git("status", "--porcelain", "--", f).trim()) throw new Error(`${f} has uncommitted changes. Commit it before any Jev routing.`);
  }
}

export async function runRoute(p: Paths, policy: PolicyThresholds, opts: RouteOptions): Promise<Route[]> {
  const tasks = loadTasks(p).slice(0, opts.limit ?? Infinity);

  if (opts.dryRun) {
    for (const t of tasks) console.log(JSON.stringify({ id: t.id, request: requestBody(t) }, null, 2));
    console.log(`\n[dry-run] ${tasks.length} request(s) printed, no API calls made.`);
    return [];
  }

  assertSplitCommitted(p);
  assertJevApproved(tasks.map((t) => t.prompt), !!opts.approveJev, "route");
  const decider = makeDecider(p.mockAnswers);
  console.log(`Routing ${tasks.length} task(s) with DECIDER=${decider.kind}, concurrency=${opts.concurrency}`);

  const results = await runPool(tasks, opts.concurrency, async (t) => {
    const r = await decider.decide(t);
    const d = decide(r.answers, policy);
    const perf = r.latency_ms === undefined ? "" : ` ${r.latency_ms}ms ${r.usage?.input_tokens ?? "?"} tok`;
    console.log(`  ${t.id}: ${d.tier.padEnd(8)} model=${r.model}${r.cached ? " (cached)" : ""}${perf}`);
    const row: Route = {
      id: t.id,
      router: "jev",
      tier: d.tier,
      reason: d.reason,
      confidence: d.confidence,
      model: r.model,
      answers: r.answers,
      cached: r.cached,
      usage: r.usage,
      latency_ms: r.latency_ms,
    };
    return row;
  });

  const rows: Route[] = [];
  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") rows.push(r.value);
    else failures.push(`  ${tasks[i]!.id}: ${(r.reason as Error)?.message ?? r.reason}`);
  });

  const out = routesPath(p, "jev");
  writeJsonl(out, rows);
  console.log(`Wrote ${rows.length} route(s) to ${out}`);
  if (failures.length) {
    console.error(`${failures.length} task(s) failed:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
  return rows;
}
