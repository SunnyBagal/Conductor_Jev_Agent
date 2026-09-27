/**
 * trackb: SWE-bench deep-dive -> reports/trackb.md. Needs runs/swebench.jsonl (run `swebench`
 * with DECIDER=typesafe first); makes no Jev calls itself.
 *
 * Honesty rules enforced here:
 *  - The tune/test split is defined once from ladders[0] (seed 7, 50/50, stratified by cheapest
 *    resolving tier over solved instances) and frozen in reports/trackb_split.json. A run that
 *    would produce a different split refuses to continue.
 *  - Jev thresholds and length cutoffs are chosen on the TUNE half only, with the original
 *    objective (mean tier rank). Costs are display-only, so adding prices did not re-open tuning.
 *  - Every run scores the TEST half and appends a line to reports/trackb_test_runs.log.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG_PATHS, type Costs, type FilledCosts, type Ladder, type PolicyThresholds, type SwebenchConfig, type ThresholdsFile } from "./config.ts";
import { ensureDir, readJson, readJsonl, TIERS, tierIndex, writeJson, type Tier } from "./data.ts";
import { computeMetrics, fmt, fmtCI, selectBest, type Count, type Pair } from "./metrics.ts";
import { decide, JevAnswersSchema, riskGateHits, type JevAnswers } from "./policy.ts";
import { stratifiedSplit } from "./split.ts";
import { expandGrid } from "./sweep.ts";
import { keywordRoute, lengthRoute } from "./baselines.ts";
import { loadInstances, loadSubmission } from "./swebench.ts";

export const SPLIT_SEED = 7;
export const SPLIT_FRACTION = 0.5;
const SPLIT_FILE = "reports/trackb_split.json";
const LOG_FILE = "reports/trackb_test_runs.log";
const REPORT_FILE = "reports/trackb.md";

// ---------------------------------------------------------------------------
// Ladder data + pure scoring
// ---------------------------------------------------------------------------

export interface TierData {
  model: string;
  submissions: string[];
  /** Resolved by ANY listed submission. */
  resolved: Set<string>;
  /** Measured USD per instance from trajectories (first submission), if recorded. */
  cost: Map<string, number> | null;
  /** Input $/MTok; output is 5x input for every model used, so ratios hold for any token mix. */
  price: number;
}
export interface LadderData {
  name: string;
  tiers: Record<Tier, TierData>;
}

export const solvedAt = (L: LadderData, id: string): Tier | null => TIERS.find((t) => L.tiers[t].resolved.has(id)) ?? null;
export const opusOnly = (L: LadderData, id: string) =>
  L.tiers.frontier.resolved.has(id) && !L.tiers.cheap.resolved.has(id) && !L.tiers.standard.resolved.has(id);

/** Idealized cascade: cheap -> standard -> frontier, stopping at the first tier that resolved it. */
export function cascadeAttempts(L: LadderData, id: string): Tier[] {
  const out: Tier[] = [];
  for (const t of TIERS) {
    out.push(t);
    if (L.tiers[t].resolved.has(id)) break;
  }
  return out;
}

const hasMeasured = (L: LadderData) => TIERS.every((t) => L.tiers[t].cost !== null);
const measured = (L: LadderData, t: Tier, id: string) => L.tiers[t].cost!.get(id) ?? NaN;
const prices = (L: LadderData): FilledCosts => ({ cheap: L.tiers.cheap.price, standard: L.tiers.standard.price, frontier: L.tiers.frontier.price, router_overhead: 0 });

export interface RouterScore {
  name: string;
  n: number;
  under: Count;
  exact: Count;
  /** The routed model itself resolved the task (no re-run). */
  firstTry: Count;
  /** Total estimated cost / (n x frontier price). Under-routed tasks pay a re-run at the cheapest resolving tier. */
  relVsFrontier: number;
  /** Mean measured USD per task, same re-run rule; null when trajectories have no costs. */
  usdPerTask: number | null;
  runsPerTask: number;
  dist: Record<Tier, number>;
}

/** Score a single-shot router on ids solved by this ladder. */
export function scoreRouter(L: LadderData, ids: readonly string[], name: string, route: (id: string) => Tier): RouterScore {
  const solved = ids.filter((id) => solvedAt(L, id));
  const pairs: Pair[] = solved.map((id) => ({ id, routed: route(id), label: solvedAt(L, id)!, sure: "yes", confidence: null }));
  const m = computeMetrics(pairs, prices(L));
  const underRerun = (p: Pair) => tierIndex(p.routed) < tierIndex(p.label);
  return {
    name,
    n: pairs.length,
    under: m.under,
    exact: m.correct,
    firstTry: { k: pairs.filter((p) => L.tiers[p.routed].resolved.has(p.id)).length, n: pairs.length },
    relVsFrontier: m.relativeCost!,
    usdPerTask: hasMeasured(L)
      ? pairs.reduce((s, p) => s + measured(L, p.routed, p.id) + (underRerun(p) ? measured(L, p.label, p.id) : 0), 0) / pairs.length
      : null,
    runsPerTask: pairs.reduce((s, p) => s + (underRerun(p) ? 2 : 1), 0) / pairs.length,
    dist: Object.fromEntries(TIERS.map((t) => [t, m.distribution[t].k])) as Record<Tier, number>,
  };
}

/** Score the idealized cascade on ids solved by this ladder (never under-routes by construction). */
export function scoreCascade(L: LadderData, ids: readonly string[]): RouterScore {
  const solved = ids.filter((id) => solvedAt(L, id));
  const att = solved.map((id) => cascadeAttempts(L, id));
  const est = att.reduce((s, a) => s + a.reduce((x, t) => x + L.tiers[t].price, 0), 0);
  const dist = Object.fromEntries(TIERS.map((t) => [t, att.filter((a) => a.at(-1) === t).length])) as Record<Tier, number>;
  return {
    name: "cascade cheap→standard→frontier",
    n: solved.length,
    under: { k: 0, n: solved.length },
    exact: { k: solved.length, n: solved.length },
    firstTry: { k: att.filter((a) => a.length === 1).length, n: solved.length },
    relVsFrontier: est / (solved.length * L.tiers.frontier.price),
    usdPerTask: hasMeasured(L) ? solved.reduce((s, id, i) => s + att[i]!.reduce((x, t) => x + measured(L, t, id), 0), 0) / solved.length : null,
    runsPerTask: att.reduce((s, a) => s + a.length, 0) / solved.length,
    dist,
  };
}

/** One attempt per task (cascade: attempts until solved), over ALL ids incl. unsolved. */
export function scoreAllTasks(L: LadderData, ids: readonly string[], name: string, attempts: (id: string) => Tier[]) {
  const att = ids.map(attempts);
  const est = att.reduce((s, a) => s + a.reduce((x, t) => x + L.tiers[t].price, 0), 0);
  return {
    name,
    resolved: { k: ids.filter((id, i) => att[i]!.some((t) => L.tiers[t].resolved.has(id))).length, n: ids.length },
    relVsFrontier: est / (ids.length * L.tiers.frontier.price),
    usdPerTask: hasMeasured(L) ? ids.reduce((s, id, i) => s + att[i]!.reduce((x, t) => x + measured(L, t, id), 0), 0) / ids.length : null,
    runsPerTask: att.reduce((s, a) => s + a.length, 0) / ids.length,
  };
}

// ---------------------------------------------------------------------------
// Scaffold metadata (item: do tiers share one agent scaffold?)
// ---------------------------------------------------------------------------

export interface SubMeta {
  submission: string;
  tier: Tier;
  date: string;
  agent: string;
  version: string;
  attempts: string;
  modelTag: string;
}

async function subMeta(sub: string, tier: Tier): Promise<SubMeta> {
  const file = join("data/swebench/meta", `${sub}.yaml`);
  ensureDir("data/swebench/meta");
  if (!existsSync(file)) {
    const r = await fetch(`https://raw.githubusercontent.com/SWE-bench/experiments/main/evaluation/verified/${encodeURIComponent(sub)}/metadata.yaml`);
    if (!r.ok) throw new Error(`${sub}: metadata.yaml -> ${r.status}`);
    writeFileSync(file, await r.text());
  }
  const y = readFileSync(file, "utf8");
  const get = (k: string) => y.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "—";
  return {
    submission: sub,
    tier,
    date: sub.slice(0, 8),
    agent: get("agent"),
    version: get("mini-swe-agent_version"),
    attempts: get("attempts"),
    modelTag: y.match(/^\s*model:\s*\n\s*-\s*(\S+)/m)?.[1] ?? "—",
  };
}

export function scaffoldFlags(ms: readonly SubMeta[]): string[] {
  const flags: string[] = [];
  const uniq = (f: (m: SubMeta) => string) => new Set(ms.map(f)).size;
  if (uniq((m) => m.agent) > 1) flags.push("different agents");
  if (uniq((m) => m.version) > 1) flags.push("different agent versions");
  if (uniq((m) => m.date) > 1) flags.push(`runs from different dates (${[...new Set(ms.map((m) => m.date))].join(", ")})`);
  for (const m of ms) if (m.attempts !== "1") flags.push(`${m.submission} is not pass@1 (attempts: ${m.attempts})`);
  return flags;
}

// ---------------------------------------------------------------------------
// Frozen split + test-run log
// ---------------------------------------------------------------------------

const SplitFileSchema = z.object({ seed: z.number(), fraction: z.number(), tune: z.array(z.string()), test: z.array(z.string()) }).loose();

export function frozenSplit(solved: { id: string; label: Tier }[]) {
  const s = stratifiedSplit(solved, SPLIT_SEED, SPLIT_FRACTION);
  if (existsSync(SPLIT_FILE)) {
    const f = readJson(SPLIT_FILE, SplitFileSchema);
    if (JSON.stringify(f.tune) !== JSON.stringify(s.tune) || JSON.stringify(f.test) !== JSON.stringify(s.test))
      throw new Error(`${SPLIT_FILE} differs from the split recomputed now. The tune/test split must not change; aborting.`);
  } else {
    const counts = Object.fromEntries(
      TIERS.map((t) => [t, { tune: s.tune.filter((id) => solved.find((x) => x.id === id)!.label === t).length, test: s.test.filter((id) => solved.find((x) => x.id === id)!.label === t).length }]),
    );
    writeJson(SPLIT_FILE, {
      seed: SPLIT_SEED,
      fraction: SPLIT_FRACTION,
      source: "instances solved by ladders[0], stratified by cheapest resolving tier",
      counts,
      tune: s.tune,
      test: s.test,
    });
  }
  return s;
}

const RETRO = [
  "# Track B TEST-half evaluations. One line per scoring of the test half. Do not delete lines.",
  "# The first entries are RETROACTIVE: they happened before this log existed (times approximate).",
  "2026-09-27\tretroactive\tanalysis: rules + baselines on test half (scratch run)",
  "2026-09-27\tretroactive\tanalysis: two-tier gate table on test half (scratch run)",
  "2026-09-27\tretroactive\tanalysis/trackb.mts saved run: rules + baselines on test half",
  "2026-09-27\tretroactive\tanalysis/trackb.mts saved run: two-tier gate table on test half",
  "2026-09-27\tretroactive\t`swebench` rule comparison on all 396 solved (includes the test half)",
];

function logTestRun(configHash: string, n: number): number {
  ensureDir("reports");
  if (!existsSync(LOG_FILE)) writeFileSync(LOG_FILE, RETRO.join("\n") + "\n");
  let commit = "nogit";
  try {
    commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "config"], { encoding: "utf8" }).trim();
    if (dirty) commit += "-dirty";
  } catch {}
  appendFileSync(LOG_FILE, `${new Date().toISOString()}\ttrackb\tcommit=${commit}\tconfig=${configHash}\tn=${n}\n`);
  return readFileSync(LOG_FILE, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const RowSchema = z.object({ id: z.string(), answers: z.unknown() }).loose();

async function loadLadder(l: Ladder, costs: Costs, ids: readonly string[]): Promise<{ data: LadderData; meta: SubMeta[] }> {
  const tiers = {} as Record<Tier, TierData>;
  const meta: SubMeta[] = [];
  for (const t of TIERS) {
    const cfg = l.tiers[t];
    const price = costs.prices_usd_per_mtok[cfg.model]?.input;
    if (price === undefined) throw new Error(`config/costs.json has no price for model "${cfg.model}"`);
    const subs = await Promise.all(cfg.submissions.map((s) => loadSubmission(s, ids)));
    tiers[t] = { model: cfg.model, submissions: cfg.submissions, resolved: new Set(subs.flatMap((s) => [...s.resolved])), cost: subs[0]?.cost ?? null, price };
    for (const s of cfg.submissions) meta.push(await subMeta(s, t));
  }
  return { data: { name: l.name, tiers }, meta };
}

export async function runTrackB(th: ThresholdsFile, costs: Costs, cfg: SwebenchConfig) {
  if (!existsSync("runs/swebench.jsonl")) throw new Error("runs/swebench.jsonl not found. Run `swebench` with DECIDER=typesafe first.");
  const rows = readJsonl("runs/swebench.jsonl", RowSchema);
  const answers = new Map<string, JevAnswers>(rows.map((r) => [r.id, JevAnswersSchema.parse(r.answers)]));
  const instances = await loadInstances();
  const statement = new Map(instances.map((x) => [x.instance_id, x.problem_statement]));
  const allIds = rows.map((r) => r.id);

  const ladders = [];
  for (const l of cfg.ladders) ladders.push(await loadLadder(l, costs, instances.map((x) => x.instance_id)));
  const L0 = ladders[0]!.data;

  // Split (frozen) from ladder 0.
  const solved0 = allIds.filter((id) => solvedAt(L0, id)).map((id) => ({ id, label: solvedAt(L0, id)! }));
  const { tune, test } = frozenSplit(solved0);
  const T = new Set(tune);

  // Tuning on TUNE half, objective unchanged (mean tier rank; costs=null).
  const cap = th.sweep.max_under_routing;
  const tuneMetrics = (f: (id: string) => Tier) =>
    computeMetrics(tune.map((id) => ({ id, routed: f(id), label: solvedAt(L0, id)!, sure: "yes" as const, confidence: null })), null);
  const byRule = new Map<number, { p: PolicyThresholds; metrics: ReturnType<typeof computeMetrics> }[]>();
  for (const p of expandGrid(th.policy, th.sweep.grid)) {
    const k = p.mass_coverage;
    if (!byRule.has(k)) byRule.set(k, []);
    byRule.get(k)!.push({ p, metrics: tuneMetrics((id) => decide(answers.get(id)!, p).tier) });
  }
  const jevRouters = [...byRule.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, c]) => {
      const best = selectBest(c, cap);
      return { name: k ? `Jev, credible set ${k}` : "Jev, confidence round-up", params: best.p, route: (id: string) => decide(answers.get(id)!, best.p).tier };
    });
  const lenCands = [];
  for (const a of th.sweep.length_cutoffs)
    for (const b of th.sweep.length_cutoffs) if (b > a) lenCands.push({ c: [a, b] as [number, number], metrics: tuneMetrics((id) => lengthRoute(statement.get(id)!, [a, b]).tier) });
  const len = selectBest(lenCands, cap);

  const gate = (id: string) => riskGateHits(answers.get(id)!, th.policy).length > 0;
  const routers: { name: string; route: (id: string) => Tier }[] = [
    ...jevRouters,
    { name: `length ${len.c.join("/")} chars`, route: (id) => lengthRoute(statement.get(id)!, len.c).tier },
    { name: "keywords", route: (id) => keywordRoute(statement.get(id)!).tier },
    { name: "always cheap", route: () => "cheap" },
    { name: "**always standard**", route: () => "standard" },
    { name: "always frontier", route: () => "frontier" },
    { name: "risk gate only (standard, risky → frontier)", route: (id) => (gate(id) ? "frontier" : "standard") },
  ];

  const configHash = createHash("sha256")
    .update(readFileSync(CONFIG_PATHS.thresholds))
    .update(readFileSync(CONFIG_PATHS.swebench))
    .update(readFileSync(CONFIG_PATHS.costs))
    .update(readFileSync(new URL("./policy.ts", import.meta.url)))
    .digest("hex")
    .slice(0, 16);
  const testRuns = logTestRun(configHash, test.length);

  // ---------------------------------------------------------------- report
  const L: string[] = [];
  const pct = (k: number, n: number) => fmt({ k, n });
  const usd = (x: number | null) => (x === null ? "—" : `$${x.toFixed(3)}`);
  L.push(`# Track B: SWE-bench Verified deep-dive\n`);
  L.push(
    `Generated by \`npm run cli -- trackb\`. Jev answers: ${new Set(rows.map((r) => r.model as string)).size === 1 ? `\`${rows[0]!.model}\`` : "mixed models"}, ${rows.length} problem statements, no new API calls. ` +
      `Test half scored **${testRuns} times** so far, including 5 retroactive entries (\`${LOG_FILE}\`).\n`,
  );

  L.push(`## 1. Submissions per tier, and whether they share one scaffold\n`);
  for (const { data, meta } of ladders) {
    const flags = scaffoldFlags(meta);
    L.push(`**${data.name}**\n`);
    L.push(`| tier | model (price key) | submission | agent | version | attempts | metadata model tag |`, `|---|---|---|---|---|---|---|`);
    for (const m of meta)
      L.push(`| ${m.tier} | ${data.tiers[m.tier].model} | \`${m.submission}\` | ${m.agent} | ${m.version} | ${m.attempts} | \`${m.modelTag}\` |`);
    L.push(
      flags.length
        ? `\n> [!WARNING]\n> **Not one clean scaffold:** ${flags.join("; ")}.${meta.some((m) => m.tier === "cheap" && /claude-3-haiku/.test(m.modelTag)) ? " The cheap run's metadata names `claude-3-haiku-20240307` although the submission is titled \"3.5 Haiku\"." : ""}\n`
        : `\nSame agent, same version, same date, all pass@1.\n`,
    );
    L.push(`Resolved: ${TIERS.map((t) => `${t} ${pct(data.tiers[t].resolved.size, 500)}`).join(", ")}.\n`);
  }
  L.push(
    `Ladder 2 resolved counts are recomputed from per-instance \`report.json\` files in the public S3 bucket and differ slightly from the leaderboard (Haiku 4.5: 335 vs 333; Sonnet 4.5: 356 vs 357; Opus 4.5: 384 vs 384). Measured costs match the leaderboard averages exactly.\n`,
  );

  L.push(`## 2. Unsolved tasks and the test-set size\n`);
  const counts = readJson(SPLIT_FILE, z.object({ counts: z.record(z.string(), z.object({ tune: z.number(), test: z.number() })) }).loose()).counts;
  L.push(
    `- **${allIds.length - solved0.length} of ${allIds.length} tasks were resolved by no tier of ladder 1.** They have no "cheapest resolving tier", so they are **excluded** from every routing table below (no router is scored on them). The all-500 table in section 5 shows what they cost.`,
    `- The remaining **${solved0.length}** were split **once** 50/50 (seed ${SPLIT_SEED}), stratified by cheapest resolving tier: ${TIERS.map((t) => `${t} ${counts[t]!.tune + counts[t]!.test} → ${counts[t]!.test} test`).join(", ")}. Halves of odd counts round up to the test side, so **test = ${test.length}**, tune = ${tune.length}.`,
    `- The split is frozen in \`${SPLIT_FILE}\`; \`trackb\` recomputes it and aborts if it differs. Ladder 2 is scored on the **same ${test.length} test ids** (minus any ladder 2 didn't solve), with thresholds tuned on ladder 1's tune half.\n`,
  );

  L.push(`## 3. Cost model\n`);
  L.push(
    `Prices are from ${costs.price_source} (retrieved ${costs.price_retrieved}), stored in \`config/costs.json\`:\n`,
    `| model | input $/MTok | output $/MTok |`,
    `|---|---|---|`,
    ...ladders.flatMap(({ data }) => TIERS.map((t) => data.tiers[t].model)).map((m) => `| ${m} | ${costs.prices_usd_per_mtok[m]!.input} | ${costs.prices_usd_per_mtok[m]!.output} |`),
    ``,
    `- **Estimated relative cost** = Σ price of each model run / (n × frontier price). Output price is exactly 5× input for every model here, so the ratio holds for any input/output mix, **assuming each model uses the same number of tokens per task**.`,
    `- **Measured $/task** (ladder 2 only) comes from each run's own \`instance_cost\` in its trajectory. It shows the equal-token assumption is wrong: Opus 4.5 costs ${usd(mean(ladders[1]?.data.tiers.frontier.cost))} per task vs Sonnet 4.5's ${usd(mean(ladders[1]?.data.tiers.standard.cost))}, i.e. ${ratio(ladders[1]?.data, "frontier", "standard")}× rather than the 1.67× the prices suggest.`,
    `- Under-routed tasks pay for the failed run plus a re-run at the cheapest tier that resolved them (assumes the failure is noticed).`,
    `- Tuning objective is unchanged (mean tier rank): prices were added after the tune/test results were seen, so they are **display-only** and did not re-select any threshold.\n`,
  );

  L.push(`## 4. Was option 1 chosen using test-set numbers?\n`);
  L.push(
    `- \`reports/test_runs.log\` (main dataset \`eval --final\`) **does not exist**: your labeled set is empty, so the main test set has never been evaluated. \`reports/data_fixtures/test_runs.log\` has one entry, a mock-decider pipeline test.`,
    `- Track B's test half was **not logged** before this command existed. It had been scored at least 5 times (now recorded retroactively in \`${LOG_FILE}\`).`,
    `- **Selection:** the credible-set rule (0.7) was picked because it scored best on the **tune** half, which is legitimate.`,
    `- **But:** I made it the default only after seeing test-half numbers, and I cited them ("same held-out under-routing, cheaper") in the commit. The untuned all-396 comparison ("fixed 8, introduced 3") also included test tasks. So the test half is **no longer untouched**. Treat the Track B test numbers as exploratory, and treat the choice of option 1 as a tune-set decision that is not confirmed on held-out data. Confirmation has to come from your own labeled set via \`eval --final\`.\n`,
  );

  for (const [i, { data }] of ladders.entries()) {
    const scores = [...routers.map((r) => scoreRouter(data, test, r.name, r.route)), scoreCascade(data, test)];
    const std = scores.find((s) => s.name.includes("always standard"))!;
    L.push(`## ${5 + i}. Results on the test half: ${data.name}\n`);
    L.push(`n = ${std.n} test tasks solved by this ladder. Jev and length thresholds were tuned on ladder 1's tune half.\n`);
    L.push(
      `| router | under-routed ↓ | routed model solved it | est. cost vs always-frontier | vs always-standard | measured $/task | runs/task | cheap/std/frontier |`,
      `|---|---|---|---|---|---|---|---|`,
    );
    for (const s of scores)
      L.push(
        `| ${s.name} | ${fmt(s.under)} ${fmtCI(s.under)} | ${fmt(s.firstTry)} | ${s.relVsFrontier.toFixed(3)} | ${(s.relVsFrontier / std.relVsFrontier).toFixed(2)}× | ${usd(s.usdPerTask)} | ${s.runsPerTask.toFixed(2)} | ${TIERS.map((t) => s.dist[t]).join("/")} |`,
      );
    const casc = scores.at(-1)!;
    L.push(
      `\n**Cascade** (item 5): ${casc.relVsFrontier.toFixed(3)} est. relative cost = **${(casc.relVsFrontier / std.relVsFrontier).toFixed(2)}× always-standard**${casc.usdPerTask !== null ? ` (measured ${usd(casc.usdPerTask)} vs ${usd(std.usdPerTask)} per task = ${(casc.usdPerTask / std.usdPerTask!).toFixed(2)}×)` : ""}, ${casc.runsPerTask.toFixed(2)} runs per task. ` +
        `This is an **upper bound**: it escalates exactly when SWE-bench's hidden tests fail, a perfect failure signal a real product doesn't have. Each extra run also adds a full agent run of wall-clock time.\n`,
    );

    // all-500 supplemental (parameter-free routers only; no tuning involved)
    const all = [
      scoreAllTasks(data, allIds, "always cheap", () => ["cheap"]),
      scoreAllTasks(data, allIds, "always standard", () => ["standard"]),
      scoreAllTasks(data, allIds, "always frontier", () => ["frontier"]),
      scoreAllTasks(data, allIds, "risk gate only", (id) => [gate(id) ? "frontier" : "standard"]),
      scoreAllTasks(data, allIds, "cascade", (id) => cascadeAttempts(data, id)),
    ];
    L.push(`All ${allIds.length} tasks including unsolved ones (untuned routers only; one run each except the cascade, which pays for every tier on unsolved tasks):\n`);
    L.push(`| router | resolved | est. cost vs always-frontier | measured $/task | runs/task |`, `|---|---|---|---|---|`);
    for (const s of all) L.push(`| ${s.name} | ${fmt(s.resolved)} | ${s.relVsFrontier.toFixed(3)} | ${usd(s.usdPerTask)} | ${s.runsPerTask.toFixed(2)} |`);
    L.push("");
  }

  const n = 5 + ladders.length;
  L.push(`## ${n}. Risk-gate-only router (item 6)\n`);
  const esc = allIds.filter(gate);
  L.push(
    `Always standard; Jev's risk questions (any risky-area Noul ≥ ${th.policy.risky} or destructive Noul ≥ ${th.policy.destructive}, config thresholds, not tuned) → frontier.\n`,
    `- Escalates **${esc.length} of ${allIds.length}** tasks (${esc.filter((id) => test.includes(id)).length} of them in the test half).`,
    ...ladders.map(
      ({ data }) =>
        `- ${data.name}: **${esc.filter((id) => opusOnly(data, id)).length}** of the escalated tasks were frontier-only (only the frontier model solved them), out of ${allIds.filter((id) => opusOnly(data, id)).length} frontier-only tasks overall.`,
    ),
    ``,
    `| escalated task | trigger |`,
    `|---|---|`,
    ...esc.slice(0, 25).map((id) => `| \`${id}\` | ${riskGateHits(answers.get(id)!, th.policy).join("; ")} |`),
    esc.length > 25 ? `\n…and ${esc.length - 25} more.` : "",
    `\nSWE-bench issues are mostly library bug reports and rarely touch auth, payments, migrations or infrastructure, so this gate is mostly untested here. It needs real product prompts.\n`,
  );

  const l1 = ladders[0]!.data, l2 = ladders[1]?.data;
  L.push(`## ${n + 1}. Limitations\n`);
  L.push(
    `**Standard and frontier score about the same, which structurally penalizes routing up.** On ladder 1, Sonnet 4 resolved ${pct(l1.tiers.standard.resolved.size, 500)} and Opus 4 ${pct(l1.tiers.frontier.resolved.size, 500)}: a ${(((l1.tiers.frontier.resolved.size - l1.tiers.standard.resolved.size) / 500) * 100).toFixed(1)}-point gap, with Opus alone solving only ${allIds.filter((id) => opusOnly(l1, id)).length} tasks. ` +
      (l2 ? `On ladder 2 the gap is ${(((l2.tiers.frontier.resolved.size - l2.tiers.standard.resolved.size) / 500) * 100).toFixed(1)} points (${l2.tiers.standard.resolved.size} vs ${l2.tiers.frontier.resolved.size}). ` : "") +
      `When the frontier model barely out-solves the standard one, any router that sends tasks up pays the frontier price for almost no extra solves, so "always standard" is structurally hard to beat. This says as much about the benchmark and model pair as about Jev.`,
    ``,
    `- **"Cheapest resolving tier" assumes higher tiers solve what lower ones solve.** They don't always (some tasks only Haiku solved). The "routed model solved it" column shows the real first-try success.`,
    `- **Single attempt per model**, so run-to-run noise is large relative to these gaps.`,
    `- **Ladder 1 is not a clean scaffold** (see section 1). Ladder 2 is clean, but it tests a single agent (mini-SWE-agent) with high reasoning effort.`,
    `- **SWE-bench issues are long human bug reports**, not the short prompts people type into an agent. Jev only sees the prompt text.`,
    `- **The test half has been viewed several times** (section 4), so treat it as exploratory, not confirmatory.`,
  );

  ensureDir("reports");
  writeFileSync(REPORT_FILE, L.join("\n") + "\n");
  console.log(`Wrote ${REPORT_FILE} (test half scored ${testRuns} times, see ${LOG_FILE})`);
}

function mean(m: Map<string, number> | null | undefined): number | null {
  if (!m || !m.size) return null;
  let s = 0;
  for (const v of m.values()) s += v;
  return s / m.size;
}
function ratio(L: LadderData | undefined, a: Tier, b: Tier): string {
  const x = mean(L?.tiers[a].cost), y = mean(L?.tiers[b].cost);
  return x !== null && y !== null ? (x / y).toFixed(2) : "?";
}
