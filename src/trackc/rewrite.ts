/**
 * Track C step 1: rewrite each selected issue as a short casual agent prompt.
 * The rewriter sees ONLY the issue text: rewriteIssue() takes a string, nothing else.
 * No labels, tiers, strata, difficulty, or outcomes are ever passed to it.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
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
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  created_at: z.string(),
});
export type PromptRow = z.infer<typeof PromptRowSchema>;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface RewriterSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  instruction: string;
}

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
) {
  const settings: RewriterSettings = { model: rewriter.id, temperature: rewriter.temperature, maxTokens: cfg.rewrite.max_tokens, instruction: cfg.rewrite.instruction };
  const instrHash = sha256(settings.instruction);
  const done = new Set(
    (existsSync(PROMPTS_FILE) ? readJsonl(PROMPTS_FILE, PromptRowSchema) : [])
      .filter((r) => r.prompt_version === cfg.rewrite.prompt_version && r.rewriter_model === settings.model && r.instruction_sha256 === instrHash)
      .map((r) => r.id),
  );
  const todo = tasks.filter((t) => !done.has(t.id)).slice(0, o.limit ?? Infinity);
  console.log(`Rewriting ${todo.length} task(s) with ${settings.model} @ T=${settings.temperature}, prompt ${cfg.rewrite.prompt_version} (${done.size} already done).`);
  const client = new Anthropic();
  const res = await runPool(todo, o.concurrency, async (t) => {
    const text = issueText.get(t.id);
    if (text === undefined) throw new Error(`${t.id}: no issue text`);
    const r = await rewriteIssue(client, text, settings);
    const row: PromptRow = {
      id: t.id,
      rewriter_model: settings.model,
      response_model: r.model,
      temperature: settings.temperature,
      prompt_version: cfg.rewrite.prompt_version,
      instruction_sha256: instrHash,
      input_sha256: sha256(text),
      output: r.text,
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
