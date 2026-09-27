/** r3 commands: validate the judge, generate two-stage rewrites, judge all 200. */
import { existsSync, writeFileSync } from "node:fs";
import { budgetedClient } from "../budget.ts";
import { z } from "zod";
import { appendJsonl, ensureDir, readJsonl, writeJsonl } from "../data.ts";
import { runPool } from "../pool.ts";
import { loadInstances } from "../swebench.ts";
import { confusion, confusionMarkdown, judgeCached, loadJudgeCache, type JudgeLabel, type JudgeSettings } from "./judge.ts";
import { PROMPTS_FILE, PromptRowSchema, sha256, type PromptRow } from "./rewrite.ts";
import { TaskRowSchema } from "./select.ts";
import { extractFacts, FactsSchema, namesOutsideFacts, rewriteFromFacts, styleLine, type Facts } from "./stages.ts";
import { applyTypos, typoSeed } from "./typos.ts";
import { loadModels, loadTrackCConfig, TASKS_FILE, VARIANTS_FILE } from "./index.ts";

export const STAGE1_FILE = "data/trackc_stage1.jsonl";
const GOLD_FILE = "data/trackc_judge_gold.jsonl";
const VALIDATION_DOC = "docs/trackc_judge_validation.md";

const GoldSchema = z.object({ set: z.string(), n: z.number(), id: z.string(), version: z.string(), text: z.string(), gold: z.enum(["clean", "fix_leak", "cause_hint", "location_hint", "missing_repro"]), borderline: z.boolean(), note: z.string() }).loose();
const Stage1RowSchema = z.object({ id: z.string(), version: z.string(), model: z.string(), facts: FactsSchema, usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }), created_at: z.string() });

function judgeSettings(): JudgeSettings {
  const j = loadTrackCConfig().judge;
  if (!j) throw new Error("config/trackc.json has no judge block");
  return { version: j.version, model: j.model, effort: j.effort, maxTokens: j.max_tokens, instruction: j.instruction };
}

/** Pre-registered gate: the judge must label every gold fix leak exactly fix_leak. */
export async function runJudgeValidate(o: { concurrency: number }) {
  const s = judgeSettings();
  const gold = readJsonl(GOLD_FILE, GoldSchema);
  const issue = new Map((await loadInstances()).map((x) => [x.instance_id, x.problem_statement]));
  const client = budgetedClient("judge-validate");
  const cache = loadJudgeCache();
  const res = await runPool(gold, o.concurrency, (g) => judgeCached(client, s, g.id, issue.get(g.id)!, "rewrite", g.text, cache));
  const failed = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) throw new Error(`${failed.length} judge call(s) failed, e.g. ${(failed[0]!.reason as Error).message}`);
  const preds = res.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof judgeCached>>>).value);
  const c = confusion(gold.map((g, i) => ({ gold: g.gold, pred: preds[i]!.label })));
  const miss = gold.map((g, i) => ({ g, p: preds[i]! })).filter((x) => x.g.gold !== x.p.label);
  const L = [
    `# Judge validation: ${s.version} (${s.model}, effort ${s.effort})\n`,
    `Gold: ${gold.length} hand-judged rewrites (r1 random 15, r2 random 15, r2's 10 previously flagged), frozen in \`${GOLD_FILE}\` before the judge ran.\n`,
    `**Pre-registered requirement:** every gold fix leak labelled exactly \`fix_leak\`. **${c.fixCaught}/${c.fixLeaks} caught, so ${c.passes ? "PASS: the judge can be used" : "FAIL: the judge is NOT used (stopping, per pre-registration)"}.**\n`,
    `Exact agreement: ${c.agreement}/${c.n}.\n`,
    confusionMarkdown(c),
    `\n## Disagreements (${miss.length})\n`,
    `| set | # | task | gold | judge | judge evidence | gold note |`,
    `|---|---|---|---|---|---|---|`,
    ...miss.map(({ g, p }) => `| ${g.set} | ${g.n} | \`${g.id}\` | ${g.gold} | **${p.label}** | ${p.evidence.replace(/\|/g, "\\|").replace(/\n/g, " ")} | ${g.note} |`),
    `\nThe \`missing_repro\` gold labels and one revised label were judged on 2026-09-28, not in the earlier review rounds (see the \`note\` column in the gold file).`,
  ];
  ensureDir("docs");
  writeFileSync(VALIDATION_DOC, L.join("\n") + "\n");
  console.log(`Judge validation: fix leaks ${c.fixCaught}/${c.fixLeaks}, agreement ${c.agreement}/${c.n} -> ${c.passes ? "PASS" : "FAIL"}. Wrote ${VALIDATION_DOC}`);
  if (!c.passes) process.exitCode = 1;
  return c.passes;
}

/** Stage 1 + Stage 2 for all tasks. Checkpointed per task; resumable. */
export async function runR3(o: { concurrency: number; limit?: number }) {
  const cfg = loadTrackCConfig();
  const models = loadModels();
  const rw = cfg.rewrite;
  if (rw.prompt_version !== "r3" || !rw.stage1 || !rw.style_variants || rw.variant_seed === undefined) throw new Error("config/trackc.json is not set up for r3");
  const stage1 = rw.stage1;
  const tasks = readJsonl(TASKS_FILE, TaskRowSchema).slice(0, o.limit ?? Infinity);
  const variantOf = new Map(readJsonl(VARIANTS_FILE, z.object({ id: z.string(), variant: z.string() }).loose()).map((r) => [r.id, r.variant]));
  const issue = new Map((await loadInstances()).map((x) => [x.instance_id, x.problem_statement]));
  const st1Done = new Map((existsSync(STAGE1_FILE) ? readJsonl(STAGE1_FILE, Stage1RowSchema) : []).filter((r) => r.version === stage1.version).map((r) => [r.id, r]));
  const r3Done = new Set(readJsonl(PROMPTS_FILE, PromptRowSchema).filter((r) => r.prompt_version === "r3").map((r) => r.id));
  const client = budgetedClient("trackc-r3");
  const s1 = { model: stage1.model, temperature: stage1.temperature, maxTokens: stage1.max_tokens, instruction: stage1.instruction };
  const todo = tasks.filter((t) => !r3Done.has(t.id));
  console.log(`r3: ${todo.length} task(s) to do (${st1Done.size} stage-1 facts cached).`);

  const res = await runPool(todo, o.concurrency, async (t) => {
    let facts: Facts;
    const cached = st1Done.get(t.id);
    if (cached) facts = cached.facts;
    else {
      const e = await extractFacts(client, issue.get(t.id)!, s1);
      facts = e.facts;
      appendJsonl(STAGE1_FILE, { id: t.id, version: stage1.version, model: e.model, facts, usage: e.usage, created_at: new Date().toISOString() });
    }
    const variant = variantOf.get(t.id);
    if (!variant) throw new Error(`${t.id}: no variant`);
    const line = styleLine(rw.style_variants![variant]!, facts);
    const instruction = `${rw.instruction}\n\n${line}`;
    const s2 = { model: models.rewriter.id, temperature: models.rewriter.temperature, maxTokens: rw.max_tokens, instruction };
    const r = await rewriteFromFacts(client, facts, s2);
    let text = r.text;
    let typo: { seed: number; edits: { word: string; result: string; op: string }[] } | undefined;
    if (variant === "typo" && rw.typo) {
      const seed = typoSeed(rw.variant_seed!, t.id);
      const out = applyTypos(text, seed, [...facts.symptom_locations, facts.reproduction ?? ""], { min: rw.typo.min_edits, max: rw.typo.max_edits, lowercase: rw.typo.lowercase });
      text = out.text;
      typo = { seed, edits: out.edits };
    }
    const row: PromptRow = {
      id: t.id,
      rewriter_model: s2.model,
      response_model: r.model,
      temperature: s2.temperature,
      prompt_version: "r3",
      instruction_sha256: sha256(instruction),
      input_sha256: sha256(JSON.stringify(facts)),
      output: text,
      variant,
      status: "active",
      stop_reason: "end_turn",
      usage: r.usage,
      created_at: new Date().toISOString(),
      facts_sha256: sha256(JSON.stringify(facts)),
      ...(typo ? { typo_seed: typo.seed, typo_edits: typo.edits } : {}),
      names_outside_facts: namesOutsideFacts(text, facts),
    };
    appendJsonl(PROMPTS_FILE, row);
    return row;
  });
  const failed = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  for (const f of failed.slice(0, 5)) console.error(`  failed: ${(f.reason as Error).message}`);
  console.log(`r3 done: ${res.length - failed.length} written, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}

/** Mark all r2 rows rejected (kept for the record). */
export function rejectR2(reason: string) {
  const rows = readJsonl(PROMPTS_FILE, PromptRowSchema);
  let n = 0;
  const out = rows.map((r) => {
    if (r.prompt_version !== "r2" || r.status === "rejected") return r;
    n++;
    return { ...r, status: "rejected" as const, rejected_reason: reason };
  });
  writeJsonl(PROMPTS_FILE, out);
  console.log(`Marked ${n} r2 rows rejected.`);
}

/** Judge every r3 rewrite and every Stage 1 facts JSON. Returns id -> labels. */
export async function runJudgeAll(o: { concurrency: number }) {
  const s = judgeSettings();
  const rows = readJsonl(PROMPTS_FILE, PromptRowSchema).filter((r) => r.prompt_version === "r3" && r.status === "active");
  const st1 = new Map(readJsonl(STAGE1_FILE, Stage1RowSchema).map((r) => [r.id, r.facts]));
  const issue = new Map((await loadInstances()).map((x) => [x.instance_id, x.problem_statement]));
  const client = budgetedClient("judge-all");
  const cache = loadJudgeCache();
  const jobs = rows.flatMap((r) => [
    { id: r.id, kind: "rewrite" as const, text: r.output },
    { id: r.id, kind: "facts" as const, text: JSON.stringify(st1.get(r.id), null, 2) },
  ]);
  const res = await runPool(jobs, o.concurrency, (j) => judgeCached(client, s, j.id, issue.get(j.id)!, j.kind, j.text, cache));
  const failed = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  for (const f of failed.slice(0, 5)) console.error(`  failed: ${(f.reason as Error).message}`);
  const labels = new Map<string, { rewrite?: JudgeLabel; facts?: JudgeLabel }>();
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const e = labels.get(jobs[i]!.id) ?? {};
    e[jobs[i]!.kind] = r.value.label;
    labels.set(jobs[i]!.id, e);
  });
  const flagged = [...labels.values()].filter((l) => l.rewrite !== "clean").length;
  console.log(`Judged ${res.length - failed.length}/${jobs.length}. Rewrites not clean: ${flagged}/${rows.length}.`);
  if (failed.length) process.exitCode = 1;
  return labels;
}
