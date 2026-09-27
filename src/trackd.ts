/**
 * Track D: real tasks on the user's own repos (docs/trackd_protocol.md).
 * The user runs every agent attempt in Claude Code; this module only registers tasks, logs
 * attempts under the protocol's rules, runs Jev once per task, and reports. No Anthropic calls.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { appendJsonl, ensureDir, readJsonl, writeJsonl, type Tier } from "./data.ts";
import type { PolicyThresholds } from "./config.ts";
import { assertJevApproved, makeDecider } from "./decider.ts";
import { decide } from "./policy.ts";

export const TD = { tasks: "data/trackd_tasks.jsonl", attempts: "data/trackd_attempts.jsonl", jev: "data/trackd_jev.jsonl", report: "reports/trackd.md" };

export const MODELS = ["haiku", "sonnet", "opus"] as const;
export type DModel = (typeof MODELS)[number];
export const TIER_OF: Record<DModel, Tier> = { haiku: "cheap", sonnet: "standard", opus: "frontier" };

export const DTaskSchema = z.object({
  task_id: z.string().min(1),
  repo: z.string().min(1),
  prompt: z.string().min(1),
  prompt_sha256: z.string(),
  test_cmd: z.string().min(1),
  base_commit: z.string().optional(),
  registered_at: z.string(),
});
export type DTask = z.infer<typeof DTaskSchema>;

export const DAttemptSchema = z.object({
  task_id: z.string(),
  model: z.enum(MODELS),
  tests_pass: z.boolean(),
  would_merge: z.boolean(),
  success: z.boolean(),
  review_minutes: z.number().min(0),
  notes: z.string(),
  claude_code_version: z.string().optional(),
  logged_at: z.string(),
});
export type DAttempt = z.infer<typeof DAttemptSchema>;

export const DJevSchema = z.object({ task_id: z.string(), tier: z.enum(["cheap", "standard", "frontier"]), reason: z.string(), model: z.string(), prompt_sha256: z.string() });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const load = <T>(f: string, s: z.ZodType<T>) => (existsSync(f) ? readJsonl(f, s) : []);

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** Why an attempt may not be logged, or null if it may. Implements protocol sections 1-3. */
export function attemptError(tasks: readonly DTask[], attempts: readonly DAttempt[], jevDone: boolean, a: Pick<DAttempt, "task_id" | "model">): string | null {
  if (!tasks.some((t) => t.task_id === a.task_id)) return `task ${a.task_id} is not registered`;
  if (!jevDone) return "Jev predictions must be recorded (trackd-jev) and committed before any attempt";
  const mine = attempts.filter((x) => x.task_id === a.task_id);
  if (mine.some((x) => x.success)) return `task ${a.task_id} already succeeded; the cascade stops at the first success`;
  if (mine.some((x) => x.model === a.model)) return `${a.model} already attempted ${a.task_id}`;
  const idx = MODELS.indexOf(a.model);
  const expected = MODELS[mine.length];
  if (idx !== mine.length) return `cascade order is haiku → sonnet → opus; next for ${a.task_id} is ${expected ?? "nothing (all three tried)"}`;
  return null;
}

/** Protocol: every task must be registered before the first attempt of any task. */
export const registrationError = (attempts: readonly DAttempt[]) => (attempts.length ? "registration is closed: attempts have started" : null);

export type DLabel = Tier | "unsolved" | "incomplete";

export function labelOf(attempts: readonly DAttempt[], taskId: string): DLabel {
  const mine = attempts.filter((a) => a.task_id === taskId);
  const win = mine.find((a) => a.success);
  if (win) return TIER_OF[win.model];
  return mine.length === MODELS.length ? "unsolved" : "incomplete";
}

export interface DCount {
  k: number;
  n: number;
}
const c = (k: number, n: number): DCount => ({ k, n });
export const fmtC = (x: DCount) => `${x.k}/${x.n}`;
const rank: Record<Tier, number> = { cheap: 0, standard: 1, frontier: 2 };

/** Compare a router's tiers to labels on tasks with a final label (solved). Counts only. */
export function compare(labels: Map<string, DLabel>, route: (id: string) => Tier, attempts: readonly DAttempt[]) {
  const solved = [...labels].filter(([, l]) => l !== "unsolved" && l !== "incomplete") as [string, Tier][];
  const n = solved.length;
  let exact = 0, under = 0, over = 0, firstTryYes = 0, firstTryNo = 0, firstTryUnobserved = 0;
  for (const [id, lab] of solved) {
    const r = route(id);
    if (r === lab) exact++;
    else if (rank[r] < rank[lab]) under++;
    else over++;
    const model = MODELS.find((m) => TIER_OF[m] === r)!;
    const att = attempts.find((a) => a.task_id === id && a.model === model);
    if (!att) firstTryUnobserved++;
    else if (att.success) firstTryYes++;
    else firstTryNo++;
  }
  return { n, exact: c(exact, n), under: c(under, n), over: c(over, n), firstTry: { yes: firstTryYes, no: firstTryNo, unobserved: firstTryUnobserved } };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function addTask(o: { id?: string; repo?: string; prompt?: string; testCmd?: string; baseCommit?: string }) {
  if (!o.id || !o.repo || !o.prompt || !o.testCmd) throw new Error("trackd-add-task needs --id, --repo, --prompt and --test-cmd");
  const reg = registrationError(load(TD.attempts, DAttemptSchema));
  if (reg) throw new Error(reg);
  const tasks = load(TD.tasks, DTaskSchema);
  if (tasks.some((t) => t.task_id === o.id)) throw new Error(`task ${o.id} already registered (prompts can't be edited)`);
  const t: DTask = { task_id: o.id, repo: o.repo, prompt: o.prompt, prompt_sha256: sha(o.prompt), test_cmd: o.testCmd, ...(o.baseCommit ? { base_commit: o.baseCommit } : {}), registered_at: new Date().toISOString() };
  appendJsonl(TD.tasks, t);
  console.log(`Registered ${t.task_id} (${tasks.length + 1} task(s)). Prompt hash ${t.prompt_sha256.slice(0, 12)}.`);
}

const yesNo = (v: string | undefined, name: string) => {
  if (v === "yes") return true;
  if (v === "no") return false;
  throw new Error(`--${name} must be yes or no`);
};

export function logAttempt(o: { id?: string; model?: string; testsPass?: string; wouldMerge?: string; reviewMin?: string; notes?: string; ccVersion?: string }) {
  if (!o.id || !o.model) throw new Error("trackd-log needs --id and --model (haiku|sonnet|opus)");
  const model = z.enum(MODELS).parse(o.model);
  const tasks = load(TD.tasks, DTaskSchema);
  const attempts = load(TD.attempts, DAttemptSchema);
  const err = attemptError(tasks, attempts, existsSync(TD.jev), { task_id: o.id, model });
  if (err) throw new Error(err);
  const tests_pass = yesNo(o.testsPass, "tests-pass");
  const would_merge = yesNo(o.wouldMerge, "would-merge");
  const review_minutes = Number(o.reviewMin);
  if (!Number.isFinite(review_minutes) || review_minutes < 0) throw new Error("--review-min must be a number of minutes");
  const a: DAttempt = { task_id: o.id, model, tests_pass, would_merge, success: tests_pass && would_merge, review_minutes, notes: o.notes ?? "", ...(o.ccVersion ? { claude_code_version: o.ccVersion } : {}), logged_at: new Date().toISOString() };
  appendJsonl(TD.attempts, a);
  const next = a.success ? "done (label = " + TIER_OF[model] + ")" : MODELS[MODELS.indexOf(model) + 1] ? `next: ${MODELS[MODELS.indexOf(model) + 1]}` : "unsolved (all three failed)";
  console.log(`Logged ${o.id} ${model}: ${a.success ? "SUCCESS" : "fail"} — ${next}.`);
}

/** One Jev call per task, with frozen thresholds. Must run (and be committed) before any attempt. */
export async function runTrackDJev(policy: PolicyThresholds, o: { approveJev: boolean }) {
  const tasks = load(TD.tasks, DTaskSchema);
  if (!tasks.length) throw new Error("no Track D tasks registered yet (trackd-add-task)");
  if (existsSync(TD.jev)) throw new Error(`${TD.jev} exists; predictions are made once, before any attempt.`);
  if (load(TD.attempts, DAttemptSchema).length) throw new Error("attempts already exist; Jev must predict before any attempt");
  assertJevApproved(tasks.map((t) => t.prompt), o.approveJev, "trackd-jev");
  const decider = makeDecider("data/trackd_mock_answers.jsonl");
  const rows = [];
  for (const t of tasks) {
    const r = await decider.decide({ id: t.task_id, prompt: t.prompt, source: "own" });
    const d = decide(r.answers, policy);
    rows.push({ task_id: t.task_id, tier: d.tier, reason: d.reason, model: r.model, prompt_sha256: t.prompt_sha256 });
  }
  writeJsonl(TD.jev, rows);
  console.log(`Wrote ${TD.jev} (${rows.length} predictions, model ${rows[0]?.model}). Commit it before the first attempt.`);
}

export function trackDReport() {
  const tasks = load(TD.tasks, DTaskSchema);
  const attempts = load(TD.attempts, DAttemptSchema);
  const jev = new Map(load(TD.jev, DJevSchema).map((r) => [r.task_id, r]));
  const labels = new Map(tasks.map((t) => [t.task_id, labelOf(attempts, t.task_id)]));
  const count = (l: DLabel) => [...labels.values()].filter((x) => x === l).length;
  const n = tasks.length;
  const routers: [string, (id: string) => Tier][] = [
    ...(jev.size === n && n > 0 ? ([["Jev", (id: string) => jev.get(id)!.tier]] as [string, (id: string) => Tier][]) : []),
    ["always cheap (Haiku)", () => "cheap"],
    ["always standard (Sonnet)", () => "standard"],
    ["always frontier (Opus)", () => "frontier"],
  ];
  const L = [
    `# Track D report: real tasks, own repos\n`,
    `Protocol: \`docs/trackd_protocol.md\`. **Counts only; n = ${n} registered tasks.**\n`,
    `- Labels: cheap ${count("cheap")}/${n}, standard ${count("standard")}/${n}, frontier ${count("frontier")}/${n}, unsolved ${count("unsolved")}/${n}, incomplete ${count("incomplete")}/${n}.`,
    `- Attempts logged: ${attempts.length}. Cascade runs per finished task: ${attempts.filter((a) => labels.get(a.task_id) !== "incomplete").length}/${n - count("incomplete")}. Total review minutes: ${attempts.reduce((s, a) => s + a.review_minutes, 0)}.`,
    `- Jev predictions: ${jev.size}/${n}${jev.size ? ` (model ${[...jev.values()][0]!.model})` : ""}.\n`,
    `| router | exact | under-routed | over-routed | routed model's own attempt: succeeded / failed / not observed |`,
    `|---|---|---|---|---|`,
  ];
  for (const [name, route] of routers) {
    const r = compare(labels, route, attempts);
    L.push(`| ${name} | ${fmtC(r.exact)} | ${fmtC(r.under)} | ${fmtC(r.over)} | ${r.firstTry.yes} / ${r.firstTry.no} / ${r.firstTry.unobserved} |`);
  }
  L.push(
    `\nRows cover solved tasks only (n = ${[...labels.values()].filter((l) => l !== "unsolved" && l !== "incomplete").length}). "Not observed" means the cascade never ran that model on the task, and success there is not assumed.`,
    `\n**Cascade (what was actually run):** never under-routes by construction; ${attempts.length} runs for ${n - count("incomplete")} finished tasks.`,
    `\n## Per task\n`,
    `| task | repo | Jev | label | attempts (model: success) | review min |`,
    `|---|---|---|---|---|---|`,
    ...tasks.map((t) => {
      const mine = attempts.filter((a) => a.task_id === t.task_id);
      return `| ${t.task_id} | ${t.repo} | ${jev.get(t.task_id)?.tier ?? "—"} | ${labels.get(t.task_id)} | ${mine.map((a) => `${a.model}: ${a.success ? "yes" : "no"}`).join(", ") || "—"} | ${mine.reduce((s, a) => s + a.review_minutes, 0)} |`;
    }),
    `\n## Limitations\n`,
    `- Small n (${n}); a difference of one or two tasks is noise.`,
    `- My own repos and tasks; not representative of Conductor users.`,
    `- "Would merge" is my own, unblinded judgement.`,
    `- One attempt per model; run-to-run variance not measured.`,
    `- Higher models never ran where a cheaper one succeeded (shown as not observed).`,
    `- Subscription runs have no per-run price, so no dollar figures.`,
  );
  ensureDir("reports");
  writeFileSync(TD.report, L.join("\n") + "\n");
  console.log(`Wrote ${TD.report}`);
}
