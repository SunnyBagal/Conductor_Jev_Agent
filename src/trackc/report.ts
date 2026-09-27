/** Track C pilot report: pure markdown from attempt records. */
import { fmt } from "../metrics.ts";
import { cascadeLabelMismatches, cascadePrune, cells, consistencyTest, inconsistencyTest, median, modelReport, qualityByTier, spendByTier, type Attempt } from "./outcomes.ts";

export interface Compute {
  usd_per_core_second: number;
  usd_per_gib_second: number;
  assumed_cores: number;
  assumed_gib: number;
}

export interface PilotInputs {
  attempts: readonly Attempt[];
  tierOrder: readonly string[];
  tierNames: Record<string, string>;
  attemptsPerModel: number;
  /** Pilot task -> stratum, and the full sample's per-stratum sizes (for projections). */
  stratumOf: Map<string, string>;
  fullAllocation: Record<string, number>;
  gate: number;
  minDiscordant: number;
  compute: Compute;
  /** The two tiers compared by H1: [hypothesised more consistent, other]. */
  h1: readonly [string, string];
}

export const modalUsd = (wall_s: number | null, c: Compute, fallbackWall: number) =>
  (wall_s ?? fallbackWall) * (c.assumed_cores * c.usd_per_core_second + c.assumed_gib * c.usd_per_gib_second);

/** Project API + Modal cost for a design (grid or cascade) to per-stratum task counts. */
export function project(
  attempts: readonly Attempt[],
  keep: readonly Attempt[],
  stratumOf: Map<string, string>,
  counts: Record<string, number>,
  c: Compute,
) {
  const walls = attempts.flatMap((a) => (a.wall_s === null ? [] : [a.wall_s]));
  const medWall = walls.length ? median(walls) : 0;
  const perTask = new Map<string, { api: number; modal: number; runs: number }>();
  for (const a of keep) {
    if (a.arm !== "casual") continue;
    const t = perTask.get(a.task_id) ?? { api: 0, modal: 0, runs: 0 };
    t.api += a.cost_usd ?? 0;
    t.modal += modalUsd(a.wall_s, c, medWall);
    t.runs++;
    perTask.set(a.task_id, t);
  }
  const mean = (xs: { api: number; modal: number; runs: number }[]) => ({
    api: xs.reduce((s, x) => s + x.api, 0) / xs.length,
    modal: xs.reduce((s, x) => s + x.modal, 0) / xs.length,
    runs: xs.reduce((s, x) => s + x.runs, 0) / xs.length,
  });
  const allTasks = [...perTask.values()];
  const overall = allTasks.length ? mean(allTasks) : { api: 0, modal: 0, runs: 0 };
  let api = 0, modal = 0, runs = 0, fallbackStrata = 0;
  for (const [s, n] of Object.entries(counts)) {
    const xs = [...perTask].filter(([t]) => stratumOf.get(t) === s).map(([, v]) => v);
    const m = xs.length ? mean(xs) : overall;
    if (!xs.length) fallbackStrata++;
    api += n * m.api;
    modal += n * m.modal;
    runs += n * m.runs;
  }
  return { api, modal, total: api + modal, runs, fallbackStrata };
}

const usd = (x: number) => `$${x.toFixed(2)}`;

export function pilotReport(p: PilotInputs): string {
  const casual = p.attempts.filter((a) => a.arm === "casual");
  const control = p.attempts.filter((a) => a.arm === "original");
  const tasks = new Set(casual.map((a) => a.task_id));
  const all = cells(p.attempts, "casual");
  const spend = spendByTier(p.attempts);
  const L: string[] = [`# Track C pilot report\n`, `${tasks.size} tasks × ${p.tierOrder.length} models × ${p.attemptsPerModel} attempts on the casual prompt, plus the control arm.\n`];

  L.push(`## Per model\n`);
  L.push(
    `| model | runs | $/run | $/task (all attempts) | median wall time | majority pass | all-attempts pass | **3/3 among passed ≥1** | 0/1/2/3 of 3 | refused | fallback | harness errors |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const t of p.tierOrder) {
    const runs = casual.filter((a) => a.tier === t);
    const s = spend.byKey.get(`casual:${t}`) ?? { usd: 0, runs: 0, missing: 0 };
    const r = modelReport(all, t, p.attemptsPerModel);
    const wall = median(runs.flatMap((a) => (a.wall_s === null ? [] : [a.wall_s])));
    L.push(
      `| ${p.tierNames[t] ?? t} | ${runs.length} | ${usd(s.usd / Math.max(1, s.runs - s.missing))} | ${usd(s.usd / Math.max(1, tasks.size))} | ${Number.isNaN(wall) ? "—" : `${Math.round(wall)} s`} | ${fmt(r.majority)} | ${fmt(r.all)} | ${fmt(r.allGivenAny)} | ${r.dist.join("/")} (n=${r.distN}) | ${r.refused} | ${r.fallback} | ${r.errors} |`,
    );
  }
  const missing = [...spend.byKey.values()].reduce((s, x) => s + x.missing, 0);
  L.push(`\nRefused and fallback runs are excluded from pass rates. ${missing ? `**${missing} run(s) reported no cost**, so the totals are lower bounds.` : "Every run reported its cost."}\n`);

  L.push(`## Spend\n`);
  const fable = p.tierOrder.at(-1)!;
  const byTier = p.tierOrder.map((t) => [t, spend.byKey.get(`casual:${t}`)?.usd ?? 0] as const);
  const casualTotal = byTier.reduce((s, [, v]) => s + v, 0);
  const controlUsd = spend.byKey.get(`original:${p.tierOrder[1]}`)?.usd ?? [...spend.byKey].filter(([k]) => k.startsWith("original:")).reduce((s, [, v]) => s + v.usd, 0);
  L.push(
    ...byTier.map(([t, v]) => `- ${p.tierNames[t] ?? t}: ${usd(v)} (${casualTotal ? ((100 * v) / casualTotal).toFixed(0) : 0}% of casual-arm spend)`),
    `- Control arm: ${usd(controlUsd)}`,
    `- **Pilot total: ${usd(spend.total)}. ${p.tierNames[fable] ?? fable}'s share: ${spend.total ? ((100 * (spend.byKey.get(`casual:${fable}`)?.usd ?? 0)) / spend.total).toFixed(0) : 0}%.**\n`,
  );

  // Fallback audit
  const withFallbackSetting = p.attempts.filter((x) => x.fallback_model !== null).length;
  const costSources = new Map<string, number>();
  for (const x of p.attempts) costSources.set(x.cost_source, (costSources.get(x.cost_source) ?? 0) + 1);
  L.push(`## Fallback and cost audit\n`);
  L.push(
    `- Runs launched with a \`--fallback-model\` set: **${withFallbackSetting}** (must be 0).`,
    `- Runs where a turn came from a different model (marked \`fallback\`, left out of pass rates): **${p.attempts.filter((x) => x.status === "fallback").length}**.`,
    `- Cost source: ${[...costSources].map(([k, v]) => `${k} ${v}`).join(", ")}.\n`,
  );

  // H1
  const [ha, hb] = p.h1;
  const prim = consistencyTest(all, ha, hb, p.attemptsPerModel, p.minDiscordant);
  const sec = inconsistencyTest(all, ha, hb, p.attemptsPerModel);
  const na = p.tierNames[ha] ?? ha, nb = p.tierNames[hb] ?? hb;
  L.push(`## H1: is ${na} more consistent than ${nb}? (pre-registered)\n`);
  L.push(
    `**Primary** (tasks both passed at least once, unweighted sign test, N_min = ${p.minDiscordant}): **${prim.verdict}**.`,
    `${prim.n} paired tasks; both 3/3 on ${prim.both}; only ${na} 3/3 on ${prim.aOnly}; only ${nb} 3/3 on ${prim.bOnly}; p = ${prim.p.toFixed(3)}.`,
    `\nSecondary (inconsistent = 1/3 or 2/3): ${na} inconsistent on ${sec.aIncons}, ${nb} on ${sec.bIncons} of ${sec.n} tasks; discordant ${sec.discordant}, p = ${sec.p.toFixed(3)}.`,
    `\nThe pilot is far too small for H1. This section only checks that the pipeline works.\n`,
  );

  // Cascade check
  const mism = cascadeLabelMismatches(p.attempts, p.tierOrder, p.gate);
  const kept = cascadePrune(p.attempts, p.tierOrder, p.gate);
  const keptCasual = kept.filter((x) => x.arm === "casual").length;
  L.push(`## Cascade labeling check\n`);
  L.push(
    mism.length
      ? `**${mism.length} label mismatch(es) between full grid and cascade. This should be impossible; it points to a bug:**\n\n${mism.map((m) => `- \`${m.task}\` (${m.rule}): grid ${m.full.tier}, cascade ${m.cascade.tier}`).join("\n")}\n`
      : `No label changed: the cascade gives the same majority and all-3 labels as the full grid on all ${tasks.size} tasks.\n`,
    `The cascade would have run ${keptCasual} of ${casual.length} casual-arm runs (${casual.length ? ((100 * keptCasual) / casual.length).toFixed(0) : 0}%).`,
    `Per-model rates under the cascade (the ones the full run can no longer measure on easy tasks):\n`,
    `| model | tasks it would run on | majority pass (grid → cascade) | 3/3 among passed ≥1 (grid → cascade) |`,
    `|---|---|---|---|`,
  );
  const prunedCells = cells(kept);
  for (const t of p.tierOrder) {
    const g = modelReport(all, t, p.attemptsPerModel), c = modelReport(prunedCells, t, p.attemptsPerModel);
    L.push(`| ${p.tierNames[t] ?? t} | ${c.tasks} of ${g.tasks} | ${fmt(g.majority)} → ${fmt(c.majority)} | ${fmt(g.allGivenAny)} → ${fmt(c.allGivenAny)} |`);
  }

  // Projections
  const full = p.fullAllocation;
  const half = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, Math.round(v / 2)]));
  const nFull = Object.values(full).reduce((x, y) => x + y, 0), nHalf = Object.values(half).reduce((x, y) => x + y, 0);
  const rows = [
    [`Full grid, ${nFull} tasks`, project(p.attempts, p.attempts, p.stratumOf, full, p.compute)],
    [`Cascade, ${nFull} tasks`, project(p.attempts, kept, p.stratumOf, full, p.compute)],
    [`Cascade, ${nHalf} tasks`, project(p.attempts, kept, p.stratumOf, half, p.compute)],
  ] as const;
  L.push(`\n## Full-run cost projection\n`);
  L.push(`| design | runs | API | Modal | **total** |`, `|---|---|---|---|---|`);
  for (const [name, r] of rows) L.push(`| ${name} | ${Math.round(r.runs)} | ${usd(r.api)} | ${usd(r.modal)} | **${usd(r.total)}** |`);
  L.push(
    `\nEach stratum's pilot mean is scaled up to that stratum's size in the full sample (${rows[0][1].fallbackStrata ? `${rows[0][1].fallbackStrata} stratum(s) had no pilot task and use the overall mean` : "every stratum had pilot tasks"}). ` +
      `Modal = measured wall time × ${p.compute.assumed_cores} core(s) and ${p.compute.assumed_gib} GiB at Sandbox prices. It excludes harness-error retries and the control arm. With ${tasks.size} pilot tasks this is rough.\n`,
  );

  if (control.length) {
    const ctrl = cells(p.attempts, "original");
    const tier = control[0]!.tier;
    const c = modelReport(ctrl, tier, p.attemptsPerModel);
    const cas = modelReport(all, tier, p.attemptsPerModel);
    L.push(`## Control arm: what the casual rewrite loses\n`);
    L.push(`${p.tierNames[tier] ?? tier} on the **original issue text**: majority pass ${fmt(c.majority)}, vs ${fmt(cas.majority)} on the casual prompt for the same tasks.\n`);
  }

  L.push(`## Patch quality proxies (passing patches)\n`, `| model | passing patches | median lines changed | median files touched | failing patches that broke existing tests |`, `|---|---|---|---|---|`);
  for (const t of p.tierOrder) {
    const q = qualityByTier(p.attempts, t);
    L.push(`| ${p.tierNames[t] ?? t} | ${q.passingPatches} | ${Number.isNaN(q.medianLines) ? "—" : q.medianLines} | ${Number.isNaN(q.medianFiles) ? "—" : q.medianFiles} | ${fmt(q.failingBrokeExistingTests)} |`);
  }
  L.push(`\n"Existing tests" = SWE-bench's PASS_TO_PASS set, not the repo's full suite.`);
  return L.join("\n") + "\n";
}
