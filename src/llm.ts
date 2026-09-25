/**
 * Claude tier classifier, shared by the optional cheap-LLM baseline (baselines.ts) and the
 * optional second labeler (label.ts). Only loaded when those flags are used.
 * Auth: the Anthropic SDK resolves ANTHROPIC_API_KEY / `ant auth login` profiles itself.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ensureDir, TierSchema, type Tier } from "./data.ts";

export const CHEAP_LLM_MODEL = process.env.CHEAP_LLM_MODEL?.trim() || "claude-haiku-4-5";
export const LABELER_MODEL = process.env.LABELER_MODEL?.trim() || "claude-opus-5";

const RUBRIC_VERSION = "r1";
const SYSTEM = `You label prompts given to an AI coding agent with the cheapest model tier that would very likely complete the task correctly on the first try.

Tiers:
- cheap: small, mechanical, low-risk edits whose result is obvious (typos, renames, docs, config values, a one-line fix at a named location).
- standard: ordinary engineering work with a clear goal: a localized bug fix, a feature with a clear spec, a contained refactor.
- frontier: hard or high-stakes work: unknown root causes, architecture or design, cross-cutting changes, vague requests that need judgment, or anything touching auth, payments, security, migrations, infrastructure, data deletion, schema changes, or git history rewrites.

When unsure between two tiers, pick the higher one. You only see the prompt text, not the codebase.`;

const OutputSchema = z.object({ tier: TierSchema, reason: z.string() });
export type LlmLabel = z.infer<typeof OutputSchema> & { model: string; cached: boolean };

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

/**
 * Classify one prompt. Cached on disk by (rubric version, model, prompt).
 * @param frontier true for the labeler: adaptive thinking + server-side refusal fallbacks.
 */
export async function classifyTier(prompt: string, model: string, frontier: boolean): Promise<LlmLabel> {
  const dir = ".cache/llm";
  ensureDir(dir);
  const key = createHash("sha256").update(JSON.stringify({ RUBRIC_VERSION, model, prompt })).digest("hex");
  const file = join(dir, `${key}.json`);
  if (existsSync(file)) {
    const hit = JSON.parse(readFileSync(file, "utf8")) as { tier: Tier; reason: string; model: string };
    return { ...OutputSchema.parse(hit), model: hit.model, cached: true };
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `<prompt>\n${prompt}\n</prompt>` }];
  const output_config = { format: zodOutputFormat(OutputSchema) };

  let parsed: z.infer<typeof OutputSchema> | null;
  let usedModel: string;
  if (frontier) {
    // Server-side fallbacks re-run a refused request on another model within the same call.
    const res = await getClient().beta.messages.parse({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages,
      output_config,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new Error(`labeler refused (${res.stop_details?.category ?? "no category"})`);
    parsed = res.parsed_output;
    usedModel = res.model;
  } else {
    const res = await getClient().messages.parse({ model, max_tokens: 1024, system: SYSTEM, messages, output_config });
    if (res.stop_reason === "refusal") throw new Error("classifier refused");
    parsed = res.parsed_output;
    usedModel = res.model;
  }
  if (!parsed) throw new Error("LLM returned no parseable output");
  writeFileSync(file, JSON.stringify({ ...parsed, model: usedModel }, null, 2));
  return { ...parsed, model: usedModel, cached: false };
}
