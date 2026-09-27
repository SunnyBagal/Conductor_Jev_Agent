/** Track C commands: select -> rewrite -> review. See docs/trackc_plan.md. */
import { existsSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ensureDir, readJson, readJsonl, writeJsonl } from "../data.ts";
import { rng } from "../split.ts";
import { loadInstances, loadSubmission } from "../swebench.ts";
import { auditRewrite } from "./audit.ts";
import { PROMPTS_FILE, PromptRowSchema, runRewrite } from "./rewrite.ts";
import { selectTasks, STRATA, TaskRowSchema, TrackCConfigSchema } from "./select.ts";
import { assignVariants } from "./variants.ts";

export const TASKS_FILE = "data/trackc_tasks.jsonl";
export const VARIANTS_FILE = "data/trackc_variants.jsonl";
const reviewFile = (version: string) => `docs/trackc_rewrite_review_${version}.md`;
const VariantRowSchema = z.object({ id: z.string(), stratum: z.string(), variant: z.string(), seed: z.number() });

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

/** Assign style variants (fixed seed, balanced per stratum). Refuses to overwrite. */
export function runVariants(force: boolean) {
  if (existsSync(VARIANTS_FILE) && !force) throw new Error(`${VARIANTS_FILE} exists; variants must not change after rewriting. Use --force only before any rewrite used them.`);
  const cfg = loadTrackCConfig();
  const styles = Object.keys(cfg.rewrite.style_variants ?? {});
  const seed = cfg.rewrite.variant_seed;
  if (!styles.length || seed === undefined) throw new Error("config/trackc.json rewrite.style_variants and variant_seed are required");
  const tasks = readJsonl(TASKS_FILE, TaskRowSchema);
  const m = assignVariants(tasks, styles, seed);
  writeJsonl(VARIANTS_FILE, tasks.map((t) => ({ id: t.id, stratum: t.stratum, variant: m.get(t.id)!, seed })));
  const counts = styles.map((v) => `${v} ${tasks.filter((t) => m.get(t.id) === v).length}`);
  console.log(`Wrote ${VARIANTS_FILE}: ${counts.join(", ")}`);
}

export async function runRewriteCmd(o: { concurrency: number; limit?: number }) {
  const cfg = loadTrackCConfig();
  const models = loadModels();
  const tasks = readJsonl(TASKS_FILE, TaskRowSchema);
  const variantOf = cfg.rewrite.style_variants
    ? new Map(readJsonl(VARIANTS_FILE, VariantRowSchema).map((r) => [r.id, r.variant]))
    : new Map<string, string>();
  const instances = await loadInstances();
  // Only the problem statement is handed to the rewriter.
  const issueText = new Map(instances.map((x) => [x.instance_id, x.problem_statement]));
  // Pilot tasks first so a partial run still covers the pilot.
  const ordered = [...tasks].sort((a, b) => Number(b.pilot) - Number(a.pilot));
  await runRewrite(ordered, issueText, cfg, models.rewriter, o, variantOf);
}

/** Review page for the current prompt version: 15 random, 10 tasks the previous version's audit flagged, and the full audit. */
export async function runReview(n = 15) {
  const cfg = loadTrackCConfig();
  const version = cfg.rewrite.prompt_version;
  const allRows = readJsonl(PROMPTS_FILE, PromptRowSchema);
  const prompts = allRows.filter((r) => r.prompt_version === version && r.status === "active");
  if (!prompts.length) throw new Error(`No ${version} rewrites in ${PROMPTS_FILE} yet. Run trackc-rewrite.`);
  const issue = new Map((await loadInstances()).map((x) => [x.instance_id, x.problem_statement]));
  const pickN = <T extends { id: string }>(xs: readonly T[], k: number, seed: number) => {
    const rand = rng(seed);
    return [...xs].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).slice(0, k).map((x) => x.r);
  };
  const clip = (s: string, max = 700) => (s.length > max ? `${s.slice(0, max)}… *(${s.length} chars total, shown truncated)*` : s);
  const flagStr = (text: string) => auditRewrite("", text).map((f) => `${f.rule} ("${f.match}")`).join("; ") || "none";
  const pick = pickN(prompts, n, cfg.seed + 15 + version.length);

  const flags = prompts.flatMap((r) => auditRewrite(r.id, r.output).map((f) => ({ ...f, text: r.output, variant: r.variant })));
  const flaggedIds = new Set(flags.map((f) => f.id));
  const limit = Math.floor(prompts.length * 0.1 - 1e-9);
  const L = [
    `# Track C rewrite review: prompt ${version}\n`,
    `Rewriter \`${prompts[0]!.rewriter_model}\`, temperature ${prompts[0]!.temperature}. The rewriter saw only the issue text plus this task's style line. Strata and prior outcomes are hidden.\n`,
    `**Audit (pre-registered: under 10%, i.e. at most ${limit} of ${prompts.length}):** ${flaggedIds.size} flagged (${((100 * flaggedIds.size) / prompts.length).toFixed(1)}%), **${flaggedIds.size <= limit ? "PASS" : "FAIL"}**.\n`,
    `**Instruction:** ${cfg.rewrite.instruction}\n`,
    `## ${pick.length} random ${version} rewrites\n`,
  ];
  pick.forEach((r, i) => {
    L.push(
      `### ${i + 1}. \`${r.id}\`, variant **${r.variant ?? "none"}**\n`,
      `> ${r.output.replace(/\n/g, "\n> ")}\n`,
      `Audit: ${flagStr(r.output)}\n`,
      `<details><summary>Original issue</summary>\n\n\`\`\`text\n${clip(issue.get(r.id) ?? "")}\n\`\`\`\n</details>\n`,
    );
  });

  const prevRejected = cfg.rewrite.rejected?.at(-1)?.version;
  if (prevRejected) {
    const prevFlagged = allRows.filter((r) => r.prompt_version === prevRejected && auditRewrite(r.id, r.output).length > 0);
    const now = new Map(prompts.map((r) => [r.id, r]));
    const ten = pickN(prevFlagged.filter((r) => now.has(r.id)), 10, cfg.seed + 10);
    L.push(`## 10 tasks the ${prevRejected} audit flagged, as rewritten in ${version}\n`, `Check: the fix or cause guess is gone, and any short reproduction is kept.\n`);
    ten.forEach((old, i) => {
      const cur = now.get(old.id)!;
      L.push(
        `### ${i + 1}. \`${old.id}\`, ${version} variant **${cur.variant ?? "none"}**\n`,
        `**${prevRejected}** (flagged: ${flagStr(old.output)}):\n\n> ${old.output.replace(/\n/g, "\n> ")}\n`,
        `**${version}** (audit: ${flagStr(cur.output)}):\n\n> ${cur.output.replace(/\n/g, "\n> ")}\n`,
        `<details><summary>Original issue</summary>\n\n\`\`\`text\n${clip(issue.get(old.id) ?? "")}\n\`\`\`\n</details>\n`,
      );
    });
  }

  L.push(
    `## Full audit: ${flaggedIds.size} of ${prompts.length} ${version} rewrites flagged\n`,
    `| task | variant | rule | matched | rewrite |`,
    `|---|---|---|---|---|`,
    ...flags.map((f) => `| \`${f.id}\` | ${f.variant ?? "—"} | ${f.rule} | "${f.match}" | ${f.text.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    "",
  );
  ensureDir("docs");
  writeFileSync(reviewFile(version), L.join("\n"));
  console.log(`Wrote ${reviewFile(version)} (audit ${flaggedIds.size}/${prompts.length}, ${flaggedIds.size <= limit ? "PASS" : "FAIL"})`);
}
