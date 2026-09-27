/**
 * Track B deep-dive (run after `swebench` with DECIDER=typesafe). Reproduces the numbers in
 * PLAN_AND_REPORT.md: tune/test split of solved SWE-bench instances, Jev rules vs baselines,
 * Jev signal by tier, and a two-tier (cheap vs standard) router.
 * Run: npx tsx analysis/trackb.mts
 */
import { readFileSync } from "node:fs";
const R = new URL("../src/", import.meta.url).href;
const { loadThresholds } = await import(R + "config.ts");
const { decide, JevAnswersSchema } = await import(R + "policy.ts");
const { computeMetrics, selectBest, fmt, fmtCI, spend } = await import(R + "metrics.ts");
const { stratifiedSplit } = await import(R + "split.ts");
const { expandGrid } = await import(R + "sweep.ts");
const { lengthRoute, keywordRoute } = await import(R + "baselines.ts");
const rows = readFileSync("runs/swebench.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.cheapest);
const ps = new Map(readFileSync("data/swebench/verified.jsonl", "utf8").trim().split("\n").map((l) => { const x = JSON.parse(l); return [x.instance_id, x.problem_statement]; }));
for (const r of rows) r.answers = JevAnswersSchema.parse(r.answers);
const th = loadThresholds();
const { tune, test } = stratifiedSplit(rows.map((r) => ({ id: r.id, label: r.cheapest })), 7, 0.5);
const T = new Set(tune), E = new Set(test);
const M = (set, f) => computeMetrics(rows.filter((r) => set.has(r.id)).map((r) => ({ id: r.id, routed: f(r), label: r.cheapest, sure: "yes", confidence: null })), null);
const cap = th.sweep.max_under_routing;
// Tune Jev per rule on TUNE half
const grid = expandGrid(th.policy, th.sweep.grid);
const byRule = new Map();
for (const p of grid) { const k = p.mass_coverage; (byRule.get(k) ?? byRule.set(k, []).get(k)).push({ p, metrics: M(T, (r) => decide(r.answers, p).tier) }); }
const out = [];
for (const [k, c] of byRule) { const b = selectBest(c, cap); out.push([k ? `jev credible ${k}` : "jev confidence", (r) => decide(r.answers, b.p).tier, b]); }
const allJev = selectBest([...byRule.values()].flat(), cap);
// length tuned on TUNE
const cuts = th.sweep.length_cutoffs; const lc = [];
for (const a of cuts) for (const b of cuts) if (b > a) lc.push({ c: [a, b], metrics: M(T, (r) => lengthRoute(ps.get(r.id), [a, b]).tier) });
const lb = selectBest(lc, cap);
const routers = [...out, ["length " + lb.c.join("/"), (r) => lengthRoute(ps.get(r.id), lb.c).tier], ["keywords", (r) => keywordRoute(ps.get(r.id)).tier], ["always_cheap", () => "cheap"], ["always_standard", () => "standard"], ["always_frontier", () => "frontier"]];
console.log(`TUNE ${T.size} / TEST ${E.size} (solved instances, stratified by cheapest resolving tier). cap=${cap}`);
console.log(`best Jev overall on tune: mass_coverage=${allJev.p.mass_coverage} ${JSON.stringify(allJev.p)}`);
for (const [name, f] of routers) { const m = M(E, f); console.log(`${name.padEnd(22)} under ${(fmt(m.under)+" "+fmtCI(m.under)).padEnd(26)} exact ${fmt(m.correct).padEnd(15)} rank ${m.meanTierRank.toFixed(3)}  c/s/f ${["cheap","standard","frontier"].map(t=>m.distribution[t].k).join("/")}`); }
// Signal: haiku (cheap) solve rate and frontier-needed rate by Jev tier (default policy, all solved + unsolved rows)
const all = readFileSync("runs/swebench.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const t of ["cheap", "standard", "frontier"]) { const g = all.filter((r) => r.jev === t); const n = g.length; const c = (k) => g.filter((r) => r.cheapest === k).length; console.log(`Jev=${t.padEnd(8)} n=${n}  cheapest=cheap ${c("cheap")} (${(100*c("cheap")/n).toFixed(0)}%)  standard ${c("standard")}  frontier ${c("frontier")} (${(100*c("frontier")/n).toFixed(1)}%)  unsolved ${c(null)} (${(100*c(null)/n).toFixed(0)}%)`); }
// Paired: confidence vs credible 0.7 at DEFAULT thresholds, where they differ
const d0 = { ...th.policy, mass_coverage: 0 }, d7 = { ...th.policy, mass_coverage: 0.7 };
let lo = 0, hi = 0, uFix = 0, uNew = 0;
for (const r of rows) { const a = decide(r.answers, d0).tier, b = decide(r.answers, d7).tier; const ix = (t) => ["cheap","standard","frontier"].indexOf(t); if (a === b) continue; ix(b) < ix(a) ? lo++ : hi++; const ua = ix(a) < ix(r.cheapest), ub = ix(b) < ix(r.cheapest); if (ua && !ub) uFix++; if (!ua && ub) uNew++; }
console.log(`default thresholds, credible 0.7 vs confidence: differ on ${lo + hi}/${rows.length} (cheaper ${lo}, pricier ${hi}); under-routing fixed ${uFix}, introduced ${uNew}`);
console.log("\n--- two-tier (cheap vs standard) ---");
// Two-tier: standard by default; cheap only when Jev's credible-set policy says cheap AND P(trivial_edit + localized_bug_fix) >= g. Frontier only via the risk gate.
const easy = (a) => (a.task_type.probabilities.trivial_edit ?? 0) + (a.task_type.probabilities.localized_bug_fix ?? 0);
const mk = (g, cov) => (r) => { const d = decide(r.answers, { ...th.policy, mass_coverage: cov }).tier; if (d === "frontier" && /risky|destroys|schema|git_history/.test(decide(r.answers, { ...th.policy, mass_coverage: cov }).reason)) return "frontier"; return easy(r.answers) >= g && d !== "frontier" ? "cheap" : "standard"; };
console.log("gate  | TUNE under / cheap share        | TEST under                    cheap share   rank");
for (const g of [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]) {
  const f = mk(g, 0.7); const a = M(T, f), b = M(E, f);
  console.log(`${String(g).padEnd(5)} | ${fmt(a.under).padEnd(14)} ${fmt(a.distribution.cheap).padEnd(15)} | ${(fmt(b.under)+" "+fmtCI(b.under)).padEnd(28)} ${fmt(b.distribution.cheap).padEnd(13)} ${b.meanTierRank.toFixed(3)}`);
}
const s = M(E, () => "standard"); console.log(`always_standard TEST under ${fmt(s.under)} ${fmtCI(s.under)} rank 1.000`);
// Among tasks Jev sends cheap at g=0.9 on TEST: how many did Haiku actually solve?
const f9 = mk(0.9, 0.7); const g9 = rows.filter((r) => E.has(r.id) && f9(r) === "cheap");
console.log(`TEST g=0.9: routed cheap ${g9.length}; Haiku solved ${g9.filter((r) => r.cheapest === "cheap").length}`);
