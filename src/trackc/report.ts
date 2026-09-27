/** Track C pilot report: pure markdown from attempt records. */
import { fmt } from "../metrics.ts";
import { cells, median, modelReport, qualityByTier, spendByTier, type Attempt } from "./outcomes.ts";

export interface PilotInputs {
  attempts: readonly Attempt[];
  tierOrder: readonly string[];
  tierNames: Record<string, string>;
  attemptsPerModel: number;
  fullRunTasks: number;
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
    `| model | runs | $/run | $/task (all attempts) | median wall time | majority pass | all-attempts pass | 0/1/2/3 of 3 | refused | fallback | harness errors |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const t of p.tierOrder) {
    const runs = casual.filter((a) => a.tier === t);
    const s = spend.byKey.get(`casual:${t}`) ?? { usd: 0, runs: 0, missing: 0 };
    const r = modelReport(all, t, p.attemptsPerModel);
    const wall = median(runs.flatMap((a) => (a.wall_s === null ? [] : [a.wall_s])));
    L.push(
      `| ${p.tierNames[t] ?? t} | ${runs.length} | ${usd(s.usd / Math.max(1, s.runs - s.missing))} | ${usd(s.usd / Math.max(1, tasks.size))} | ${Number.isNaN(wall) ? "—" : `${Math.round(wall)} s`} | ${fmt(r.majority)} | ${fmt(r.all)} | ${r.dist.join("/")} (n=${r.distN}) | ${r.refused} | ${r.fallback} | ${r.errors} |`,
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

  const perTask = tasks.size ? casualTotal / tasks.size : 0;
  L.push(`## Full-run projection\n`);
  L.push(
    `Casual arm: ${usd(perTask)} per task (all 4 models × ${p.attemptsPerModel} attempts). ${p.fullRunTasks} tasks → **${usd(perTask * p.fullRunTasks)}** in API spend, before sandbox compute and retries of harness errors. ` +
      `With only ${tasks.size} pilot tasks this is a rough estimate. Cost per task varies a lot between tasks.\n`,
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
