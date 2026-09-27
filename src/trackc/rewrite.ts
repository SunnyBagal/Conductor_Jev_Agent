/**
 * Track C step 1: rewrite each selected issue as a short casual agent prompt.
 * The rewriter sees ONLY the issue text: rewriteIssue() takes a string, nothing else.
 * No labels, tiers, strata, difficulty, or outcomes are ever passed to it.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { budgetedClient } from "../budget.ts";
import { z } from "zod";
import { appendJsonl, readJsonl } from "../data.ts";
import { runPool } from "../pool.ts";
import type { TrackCConfig } from "./select.ts";

export const PROMPTS_FILE = "data/trackc_prompts.jsonl";

export const PromptRowSchema = z.object({
  id: z.string(),
  rewriter_model: z.string(),
  response_model: z.string(),
  temperature: z.number(),
  prompt_version: z.string(),
  instruction_sha256: z.string(),
  input_sha256: z.string(),
  output: z.string().min(1),
  /** Style variant whose line was appended to the system prompt (r2+). */
  variant: z.string().nullable().default(null),
  /** "rejected" rows are kept for the record and never used downstream. */
  status: z.enum(["active", "rejected"]).default("active"),
  rejected_reason: z.string().optional(),
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  created_at: z.string(),
  /** r3: hash of the Stage 1 facts this rewrite was generated from. */
  facts_sha256: z.string().optional(),
  /** r3 typo variant: seed and the edits applied in code. */
  typo_seed: z.number().optional(),
  typo_edits: z.array(z.object({ word: z.string(), result: z.string(), op: z.string() })).optional(),
  /** r3: names in the rewrite not present in the Stage 1 facts. */
  names_outside_facts: z.array(z.string()).optional(),
});
export type PromptRow = z.infer<typeof PromptRowSchema>;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface RewriterSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  instruction: string;
}

/** The system prompt for one task: the fixed instruction plus that task's style line, if any. */
export const instructionFor = (base: string, variantLine: string | null) => (variantLine ? `${base}\n\n${variantLine}` : base);

/** One rewrite. Input is the issue text only. */
export async function rewriteIssue(client: Anthropic, issueText: string, s: RewriterSettings) {
  const res = await client.messages.create({
    model: s.model,
    max_tokens: s.maxTokens,
    temperature: s.temperature,
    system: s.instruction,
    messages: [{ role: "user", content: `<bug_report>\n${issueText}\n</bug_report>` }],
  });
  if (res.stop_reason === "refusal") throw new Error("rewriter refused");
  if (res.stop_reason === "max_tokens") throw new Error("rewrite hit max_tokens");
  const text = res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (!text) throw new Error("empty rewrite");
  return { text, model: res.model, stop_reason: res.stop_reason, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

export async function runRewrite(
  tasks: readonly { id: string }[],
  issueText: Map<string, string>,
  cfg: TrackCConfig,
  rewriter: { id: string; temperature: number },
  o: { concurrency: number; limit?: number },
  variantOf: Map<string, string> = new Map(),
) {
  const base: RewriterSettings = { model: rewriter.id, temperature: rewriter.temperature, maxTokens: cfg.rewrite.max_tokens, instruction: cfg.rewrite.instruction };
  const styles = cfg.rewrite.style_variants ?? {};
  if (Object.keys(styles).length && tasks.some((t) => !variantOf.has(t.id))) throw new Error("style variants configured but some tasks have no assigned variant");
  const done = new Set(
    (existsSync(PROMPTS_FILE) ? readJsonl(PROMPTS_FILE, PromptRowSchema) : [])
      .filter((r) => r.prompt_version === cfg.rewrite.prompt_version && r.rewriter_model === base.model)
      .map((r) => r.id),
  );
  const todo = tasks.filter((t) => !done.has(t.id)).slice(0, o.limit ?? Infinity);
  console.log(`Rewriting ${todo.length} task(s) with ${base.model} @ T=${base.temperature}, prompt ${cfg.rewrite.prompt_version} (${done.size} already done).`);
  const client = budgetedClient("trackc-rewrite");
  const res = await runPool(todo, o.concurrency, async (t) => {
    const text = issueText.get(t.id);
    if (text === undefined) throw new Error(`${t.id}: no issue text`);
    const variant = variantOf.get(t.id) ?? null;
    const variantLine = variant === null ? null : (styles[variant] ?? null);
    if (variant !== null && variantLine === null) throw new Error(`${t.id}: unknown variant "${variant}"`);
    const settings = { ...base, instruction: instructionFor(base.instruction, variantLine) };
    const r = await rewriteIssue(client, text, settings);
    const row: PromptRow = {
      id: t.id,
      rewriter_model: settings.model,
      response_model: r.model,
      temperature: settings.temperature,
      prompt_version: cfg.rewrite.prompt_version,
      instruction_sha256: sha256(settings.instruction),
      input_sha256: sha256(text),
      output: r.text,
      variant,
      status: "active",
      stop_reason: r.stop_reason,
      usage: r.usage,
      created_at: new Date().toISOString(),
    };
    appendJsonl(PROMPTS_FILE, row); // checkpoint per task
    return row;
  });
  const failed = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  for (const f of failed.slice(0, 5)) console.error(`  failed: ${(f.reason as Error).message}`);
  console.log(`Done: ${res.length - failed.length} written to ${PROMPTS_FILE}, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}
