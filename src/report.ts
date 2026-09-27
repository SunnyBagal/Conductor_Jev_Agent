/**
 * report: reports/report.md (+ sweep.svg) from runs/eval_<set>.json, runs/sweep.json and,
 * if present, runs/swebench_eval.json. Default reads the TUNE eval; --final reads the TEST eval.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FilledCosts } from "./config.ts";
import { ensureDir, loadRoutes, loadTasks, routesPath, TIERS, tierIndex, type Paths } from "./data.ts";
import type { EvalResult, RouterResult } from "./eval.ts";
import { testRunCount } from "./eval.ts";
import { fmt, fmtCI, overhead, spend, type Count, type Metrics } from "./metrics.ts";
import { sweepSvg } from "./chart.ts";
import { JEV_MODEL, JEV_USD_PER_MTOK_INPUT, QUESTION_SET_VERSION } from "./questions.ts";

const readJ = <T>(f: string): T | null => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null);
const rate = (c: Count) => (c.n ? c.k / c.n : 0);
const spendStr = (m: Metrics) => (m.relativeCost === null ? `rank ${m.meanTierRank.toFixed(2)}` : m.relativeCost.toFixed(3));

/** A baseline "matches or beats" Jev if it is no worse on under-routing AND no worse on spend. */
export function beatsJev(jev: Metrics, other: Metrics): boolean {
  return rate(other.under) <= rate(jev.under) && spend(other) <= spend(jev);
}

export function headline(e: EvalResult): string {
  const jev = e.results.find((r) => r.router === "jev")!;
  const setName = e.set === "test" ? "held-out TEST set" : "TUNE set (not a final result)";
  const cost = jev.metrics.relativeCost === null ? "" : `, at ${jev.metrics.relativeCost.toFixed(2)}× the cost of sending everything to frontier`;
  let s = `On the ${setName}, Jev under-routed ${fmt(jev.metrics.under)} of tasks${cost}.`;
  const winners = e.results.filter((r) => r.router !== "jev" && beatsJev(jev.metrics, r.metrics));
  if (winners.length)
    s += ` **Baseline${winners.length > 1 ? "s" : ""} ${winners.map((w) => `\`${w.router}\``).join(", ")} match${winners.length > 1 ? "" : "es"} or beat${winners.length > 1 ? "" : "s"} Jev** (no more under-routing, no higher spend).`;
  else s += " No baseline matched Jev on both under-routing and spend.";
  return s;
}

function examples(jev: RouterResult, prompts: Map<string, string>) {
  const byId = new Map(jev.routes.map((r) => [r.id, r]));
  const failures = jev.pairs.filter((p) => tierIndex(p.routed) < tierIndex(p.label));
  const overs = jev.pairs.filter((p) => tierIndex(p.routed) > tierIndex(p.label));
  const right = jev.pairs.filter((p) => p.routed === p.label);
  const picked = [...failures.slice(0, 2), ...overs.slice(0, 1)];
  for (const t of TIERS) {
    const r = right.find((p) => p.label === t && !picked.includes(p));
    if (r) picked.push(r);
  }
  for (const p of jev.pairs) if (picked.length < 5 && !picked.includes(p)) picked.push(p);
  return picked.slice(0, 5).map((p) => {
    const kind = p.routed === p.label ? "✅ correct" : tierIndex(p.routed) < tierIndex(p.label) ? "❌ UNDER-routed" : "⚠️ over-routed";
    const prompt = (prompts.get(p.id) ?? "").replace(/\s+/g, " ");
    return `**${p.id}** — ${kind}: label \`${p.label}\` (sure=${p.sure}), Jev \`${p.routed}\`\n> ${prompt.length > 220 ? prompt.slice(0, 220) + "…" : prompt}\n\nReason: ${byId.get(p.id)?.reason ?? ""}`;
  });
}

export function runReport(p: Paths, costs: FilledCosts | null, final: boolean) {
  const set = final ? "test" : "tune";
  const e = readJ<EvalResult>(join(p.runsDir, `eval_${set}.json`));
  if (!e) throw new Error(`${join(p.runsDir, `eval_${set}.json`)} not found. Run \`eval${final ? " --final" : ""}\` first.`);
  const tuneEval = readJ<EvalResult>(join(p.runsDir, "eval_tune.json"));
  const sweep = readJ<{ n: number; spend_measure: string; max_under_routing: number; grid_size: number; best: { params: Record<string, number>; under: Count; correct: Count; spend: number }; pareto: { params: Record<string, number>; under: Count; correct: Count; spend: number }[] }>(join(p.runsDir, "sweep.json"));
  type RuleRow = { rule: string; under: Count; exact: Count; over: Count; mean_tier_rank: number; relative_cost: number | null };
  const swe = readJ<Record<string, unknown> & { rules?: RuleRow[]; sampled: number; unsolved_by_any_tier: Count; under: Count; exact: Count; over: Count; cheapest_distribution: Record<string, Count>; jev_tier_by_human_difficulty: Record<string, Record<string, number>>; submissions: Record<string, string[]>; models: string[] }>(join(p.runsDir, "swebench_eval.json"));
  const meta = readJ<{ length_cutoffs: number[] }>(join(p.runsDir, "baselines_meta.json"));
  const prompts = new Map(loadTasks(p).map((t) => [t.id, t.prompt]));
  const jev = e.results.find((r) => r.router === "jev")!;
  const runs = testRunCount(p);
  const L: string[] = [];

  L.push(`# Jev router evaluation\n`);
  if (e.mock)
    L.push(`> [!WARNING]\n> **MOCK DECIDER.** Jev answers came from a mock file, not the TypeSafe API. These numbers test the pipeline only and say nothing about Jev.\n`);
  if (/fixture/i.test(p.dataDir)) L.push(`> [!NOTE]\n> Built from **pipeline-test fixtures**, not a real dataset.\n`);
  L.push(`## Headline\n\n${headline(e)}\n`);
  L.push(
    `- Set: **${e.set.toUpperCase()}**, ${jev.metrics.n} labeled tasks. Test set evaluated **${runs} time(s)** (see \`${p.testRunsLog}\`).`,
    `- Jev model: ${jev.models.join(", ") || "n/a"} (requested \`${JEV_MODEL}\`), question set \`${QUESTION_SET_VERSION}\`, router config \`${e.config_hash}\`.`,
    `- Cost: ${costs ? "relative to sending every task to frontier; an under-routed task pays cheap attempt + re-run at its labeled tier." : "**config/costs.json is not filled in**, so spend is shown as mean tier rank (cheap=0, standard=1, frontier=2), not money."}`,
    `- Brackets are Wilson 95% intervals. With small n they are wide; read them.\n`,
  );

  L.push(`## Routers compared (${e.set} set)\n`);
  L.push(`| router | under-routed ↓ | over-routed | exact | exact when sure=no | spend | cheap / standard / frontier |`);
  L.push(`|---|---|---|---|---|---|---|`);
  for (const r of e.results) {
    const m = r.metrics;
    const d = TIERS.map((t) => m.distribution[t].k).join(" / ");
    L.push(`| ${r.router === "jev" ? "**jev**" : r.router} | ${fmt(m.under)} ${fmtCI(m.under)} | ${fmt(m.over)} | ${fmt(m.correct)} | ${fmt(m.sureNo.correct)} | ${spendStr(m)} | ${d} |`);
  }
  if (meta) L.push(`\n\`length\` cutoffs ${meta.length_cutoffs.join("/")} chars were tuned on the tune set only.`);
  const missing = e.results.filter((r) => r.missing);
  if (missing.length) L.push(`\nMissing routes: ${missing.map((r) => `${r.router} ${r.missing}`).join(", ")} of ${e.ids} ids.`);

  L.push(`\n## Jev detail\n`);
  L.push(`Confusion matrix (rows = your label, columns = Jev):\n`);
  L.push(`| label \\ Jev | ${TIERS.join(" | ")} |`, `|---|${TIERS.map(() => "---").join("|")}|`);
  for (const t of TIERS) L.push(`| ${t} | ${TIERS.map((c) => jev.metrics.confusion[t][c]).join(" | ")} |`);
  L.push(`\nPrompts you marked \`sure=no\`: exact ${fmt(jev.metrics.sureNo.correct)}, under-routed ${fmt(jev.metrics.sureNo.under)}.\n`);
  if (jev.buckets) {
    L.push(`Accuracy by Jev confidence (min of task_type and scope confidence):\n`);
    L.push(`| confidence | exact | under-routed |`, `|---|---|---|`);
    for (const b of jev.buckets) L.push(`| ${b.bucket} | ${fmt(b.correct)} | ${fmt(b.under)} |`);
  }

  L.push(`\n## Jev overhead (real calls)\n`);
  const oh = existsSync(routesPath(p, "jev")) ? overhead(loadRoutes(p, "jev"), JEV_USD_PER_MTOK_INPUT) : null;
  if (!oh) L.push(`No real Jev calls yet (mock decider). Run \`route\` with DECIDER=typesafe.`);
  else
    L.push(
      `${oh.calls} call(s). Input tokens per task: mean ${Math.round(oh.input_tokens.mean)}, median ${oh.input_tokens.p50}, max ${oh.input_tokens.max}.`,
      `Latency (wall time incl. SDK retries): median ${oh.latency_ms.p50} ms, p95 ${oh.latency_ms.p95} ms, max ${oh.latency_ms.max} ms.`,
      `Cost: **$${oh.usd_per_1k_tasks.toFixed(3)} per 1,000 routed tasks** at the documented $${JEV_USD_PER_MTOK_INPUT}/M input tokens. Use this for \`router_overhead\` in config/costs.json.`,
    );

  L.push(`\n## Threshold sweep (TUNE set only)\n`);
  if (!sweep) L.push(`Not run yet. Run \`sweep\`.`);
  else {
    L.push(`${sweep.grid_size} threshold settings tried on ${sweep.n} tune tasks. Rule: cheapest setting with under-routing ≤ ${(sweep.max_under_routing * 100).toFixed(0)}%. Spend = ${sweep.spend_measure}.\n`);
    L.push(`Chosen: \`${JSON.stringify(sweep.best.params)}\` → under-routed ${fmt(sweep.best.under)}, exact ${fmt(sweep.best.correct)}, spend ${sweep.best.spend.toFixed(3)}.\n`);
    L.push(`| spend | under-routed | exact | uncertainty rule | key thresholds (risky / destructive / task_type_conf / scope_conf) |`, `|---|---|---|---|---|`);
    for (const q of sweep.pareto.slice(0, 15))
      L.push(`| ${q.spend.toFixed(3)} | ${fmt(q.under)} | ${fmt(q.correct)} | ${q.params.mass_coverage ? `credible set ${q.params.mass_coverage}` : "confidence"} | ${q.params.risky} / ${q.params.destructive} / ${q.params.task_type_conf} / ${q.params.scope_conf} |`);
    const baselinePts = (tuneEval?.results ?? [])
      .filter((r) => r.router !== "jev")
      .map((r) => ({ spend: spend(r.metrics), under: rate(r.metrics.under), label: r.router }));
    ensureDir(p.reportsDir);
    writeFileSync(
      join(p.reportsDir, "sweep.svg"),
      sweepSvg(
        sweep.pareto.map((q) => ({ spend: q.spend, under: rate(q.under) })),
        { spend: sweep.best.spend, under: rate(sweep.best.under) },
        baselinePts,
        costs ? "relative cost vs all-frontier" : "mean tier rank",
      ),
    );
    L.push(`\n![Savings vs under-routing](sweep.svg)\n`);
  }

  L.push(`## Example routings (${e.set} set)\n`);
  L.push(examples(jev, prompts).join("\n\n") || "No labeled tasks.");

  L.push(`\n## Track B: SWE-bench Verified\n`);
  if (!swe) L.push(`Skipped. Fill in \`config/swebench.json\` and run \`swebench\`.`);
  else {
    L.push(
      `${swe.sampled} sampled problem statements. Solved by no listed tier: ${fmt(swe.unsolved_by_any_tier)}.`,
      `Among solved ones, vs the cheapest tier that resolved it: under-routed ${fmt(swe.under)}, exact ${fmt(swe.exact)}, over-routed ${fmt(swe.over)}.`,
      `Submissions: ${TIERS.map((t) => `${t}: ${(swe.submissions[t] ?? []).join(", ")}`).join("; ")}. Jev model: ${swe.models.join(", ")}.\n`,
      `Jev tier by SWE-bench human difficulty estimate:\n`,
      `| difficulty | ${TIERS.join(" | ")} |`,
      `|---|${TIERS.map(() => "---").join("|")}|`,
      ...Object.entries(swe.jev_tier_by_human_difficulty).map(([d, c]) => `| ${d} | ${TIERS.map((t) => c[t] ?? 0).join(" | ")} |`),
    );
    if (swe.rules?.length) {
      L.push(`\nUncertainty rules on the same Jev answers (solved instances; other thresholds as configured):\n`);
      L.push(`| rule | under-routed ↓ | exact | over-routed | spend |`, `|---|---|---|---|---|`);
      for (const r of swe.rules)
        L.push(`| ${r.rule} | ${fmt(r.under)} ${fmtCI(r.under)} | ${fmt(r.exact)} | ${fmt(r.over)} | ${r.relative_cost === null ? `rank ${r.mean_tier_rank.toFixed(2)}` : r.relative_cost.toFixed(3)} |`);
    }
  }

  L.push(`\n## Limitations\n`);
  L.push(
    `- **Small sample.** ${jev.metrics.n} tasks in this set. One or two tasks move a rate by several points; see the intervals.`,
    `- **Labels are one person's opinion** of the cheapest tier that would succeed, not measured outcomes.`,
    `- **SWE-bench is not representative of agent prompts.** Issues are long and written for humans; submissions differ in agent scaffold, not just model; each is a single attempt.`,
    `- **Jev is literal and only sees the prompt text**, not the codebase. A prompt can also talk it into a tier ("just a quick fix").`,
    `- **Cost model is optimistic:** it assumes every under-routed failure is noticed and re-run. Silent bad output costs more.`,
    `- Thresholds were tuned on the tune set; only \`--final\` numbers are held out, and every \`--final\` run is logged.`,
  );

  ensureDir(p.reportsDir);
  const out = join(p.reportsDir, "report.md");
  writeFileSync(out, L.join("\n") + "\n");
  console.log(`Wrote ${out}`);
  return out;
}
