/** Track C commands: select -> rewrite -> review. See docs/trackc_plan.md. */
import { existsSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ensureDir, readJson, readJsonl, writeJsonl } from "../data.ts";
import { rng } from "../split.ts";
import { loadInstances, loadSubmission } from "../swebench.ts";
import { PROMPTS_FILE, PromptRowSchema, runRewrite } from "./rewrite.ts";
import { selectTasks, STRATA, TaskRowSchema, TrackCConfigSchema } from "./select.ts";

export const TASKS_FILE = "data/trackc_tasks.jsonl";
const REVIEW_FILE = "docs/trackc_rewrite_review.md";

const ModelsSchema = z.object({
  tiers: z.record(z.string(), z.object({ id: z.string(), input_usd_per_mtok: z.number(), output_usd_per_mtok: z.number() }).loose()),
  rewriter: z.object({ id: z.string(), temperature: z.number() }).loose(),
}).loose();

export const loadTrackCConfig = () => readJson("config/trackc.json", TrackCConfigSchema);
export const loadModels = () => readJson("config/models.json", ModelsSchema);

export async function runSelect(force: boolean) {
  if (existsSync(TASKS_FILE) && !force)
    throw new Error(`${TASKS_FILE} exists. Reselecting after rewrites or runs changes the sample; use --force only if nothing downstream has run.`);
  const cfg = loadTrackCConfig();
  const instances = await loadInstances();
  const ids = instances.map((x) => x.instance_id);
  const [haiku, sonnet, opus] = await Promise.all(
    [cfg.prior_ladder.haiku, cfg.prior_ladder.sonnet, cfg.prior_ladder.opus].map(async (s) => (await loadSubmission(s, ids)).resolved),
  );
  const rows = selectTasks(instances.map((x) => ({ id: x.instance_id, difficulty: x.difficulty })), { haiku: haiku!, sonnet: sonnet!, opus: opus! }, cfg);
  writeJsonl(TASKS_FILE, rows);
  console.log(`Wrote ${TASKS_FILE}: ${rows.length} tasks (${rows.filter((r) => r.pilot).length} pilot).`);
  for (const s of STRATA) {
    const r = rows.filter((x) => x.stratum === s);
    const repos = new Map<string, number>();
    for (const x of r) repos.set(x.repo, (repos.get(x.repo) ?? 0) + 1);
    const top = [...repos.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`  ${s.padEnd(14)} pool ${String(r[0]?.pool ?? 0).padStart(3)}  take ${String(r.length).padStart(3)}  weight ${(r[0]?.weight ?? 0).toFixed(2)}  top repo ${top ? `${top[0]} ${top[1]}` : "-"}`);
  }
}

export async function runRewriteCmd(o: { concurrency: number; limit?: number }) {
  const cfg = loadTrackCConfig();
  const models = loadModels();
  const tasks = readJsonl(TASKS_FILE, TaskRowSchema);
  const instances = await loadInstances();
  // Only the problem statement is handed to the rewriter.
  const issueText = new Map(instances.map((x) => [x.instance_id, x.problem_statement]));
  // Pilot tasks first so a partial run still covers the pilot.
  const ordered = [...tasks].sort((a, b) => Number(b.pilot) - Number(a.pilot));
  await runRewrite(ordered, issueText, cfg, models.rewriter, o);
}

/** 15 random rewrites next to their originals, for human review. Hides strata and priors. */
export async function runReview(n = 15) {
  const cfg = loadTrackCConfig();
  const prompts = readJsonl(PROMPTS_FILE, PromptRowSchema).filter((r) => r.prompt_version === cfg.rewrite.prompt_version);
  if (!prompts.length) throw new Error(`No rewrites in ${PROMPTS_FILE} yet. Run trackc-rewrite.`);
  const issue = new Map((await loadInstances()).map((x) => [x.instance_id, x.problem_statement]));
  const rand = rng(cfg.seed + 15);
  const pick = [...prompts].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.r);
  const clip = (s: string, max = 700) => (s.length > max ? `${s.slice(0, max)}… *(${s.length} chars total, shown truncated)*` : s);
  const L = [
    `# Track C rewrite review (${pick.length} random of ${prompts.length})\n`,
    `Rewriter \`${prompts[0]!.rewriter_model}\` (response model \`${prompts[0]!.response_model}\`), temperature ${prompts[0]!.temperature}, prompt \`${cfg.rewrite.prompt_version}\`. ` +
      `The rewriter saw only the issue text. Strata and prior outcomes are hidden here on purpose.\n`,
    `**Instruction:** ${cfg.rewrite.instruction}\n`,
  ];
  pick.forEach((r, i) => {
    L.push(`## ${i + 1}. \`${r.id}\`\n`, `**Casual prompt:**\n\n> ${r.output.replace(/\n/g, "\n> ")}\n`, `<details><summary>Original issue</summary>\n\n\`\`\`text\n${clip(issue.get(r.id) ?? "")}\n\`\`\`\n</details>\n`);
  });
  ensureDir("docs");
  writeFileSync(REVIEW_FILE, L.join("\n"));
  console.log(`Wrote ${REVIEW_FILE}`);
}
