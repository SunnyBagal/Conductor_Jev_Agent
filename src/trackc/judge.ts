/**
 * LLM judge for rewrites and Stage 1 facts. Validated against frozen hand labels before use
 * (docs/trackc_plan.md, r3). Results are cached per (judge version, kind, artifact hash).
 */
import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { appendJsonl, readJsonl } from "../data.ts";
import { sha256 } from "./rewrite.ts";

export const LABELS = ["clean", "fix_leak", "cause_hint", "location_hint", "missing_repro"] as const;
export type JudgeLabel = (typeof LABELS)[number];

const VerdictSchema = z.object({ label: z.enum(LABELS), evidence: z.string(), reason: z.string() });

export const JudgeRowSchema = z.object({
  judge_version: z.string(),
  model: z.string(),
  kind: z.enum(["rewrite", "facts"]),
  id: z.string(),
  artifact_sha256: z.string(),
  label: z.enum(LABELS),
  evidence: z.string(),
  reason: z.string(),
  stop_reason: z.string().nullable(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  created_at: z.string(),
});
export type JudgeRow = z.infer<typeof JudgeRowSchema>;

export const JUDGE_FILE = "data/trackc_judge.jsonl";

export interface JudgeSettings {
  version: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  instruction: string;
}

export async function judgeOne(client: Anthropic, s: JudgeSettings, original: string, kind: "rewrite" | "facts", artifact: string) {
  const res = await client.messages.parse({
    model: s.model,
    max_tokens: s.maxTokens,
    system: s.instruction,
    messages: [
      {
        role: "user",
        content: `<original_report>\n${original}\n</original_report>\n\n<${kind === "rewrite" ? "message" : "facts_json"}>\n${artifact}\n</${kind === "rewrite" ? "message" : "facts_json"}>`,
      },
    ],
    output_config: { effort: s.effort, format: zodOutputFormat(VerdictSchema) },
  });
  if (res.stop_reason === "refusal") throw new Error("judge refused");
  if (!res.parsed_output) throw new Error(`judge returned no parseable verdict (stop_reason ${res.stop_reason})`);
  return { ...res.parsed_output, model: res.model, stop_reason: res.stop_reason, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

/** Cached judge: returns an existing row for the same (version, kind, id, artifact) or calls the model. */
export async function judgeCached(client: Anthropic, s: JudgeSettings, id: string, original: string, kind: "rewrite" | "facts", artifact: string, cache: Map<string, JudgeRow>): Promise<JudgeRow> {
  const key = `${s.version}|${kind}|${id}|${sha256(artifact)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const v = await judgeOne(client, s, original, kind, artifact);
  const row: JudgeRow = { judge_version: s.version, model: v.model, kind, id, artifact_sha256: sha256(artifact), label: v.label, evidence: v.evidence, reason: v.reason, stop_reason: v.stop_reason, usage: v.usage, created_at: new Date().toISOString() };
  appendJsonl(JUDGE_FILE, row);
  cache.set(key, row);
  return row;
}

export function loadJudgeCache(): Map<string, JudgeRow> {
  const rows = existsSync(JUDGE_FILE) ? readJsonl(JUDGE_FILE, JudgeRowSchema) : [];
  return new Map(rows.map((r) => [`${r.judge_version}|${r.kind}|${r.id}|${r.artifact_sha256}`, r]));
}

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

export function confusion(pairs: readonly { gold: JudgeLabel; pred: JudgeLabel }[]) {
  const m = Object.fromEntries(LABELS.map((g) => [g, Object.fromEntries(LABELS.map((p) => [p, 0]))])) as Record<JudgeLabel, Record<JudgeLabel, number>>;
  for (const x of pairs) m[x.gold][x.pred]++;
  const goldFix = pairs.filter((x) => x.gold === "fix_leak");
  const caught = goldFix.filter((x) => x.pred === "fix_leak").length;
  return {
    matrix: m,
    fixLeaks: goldFix.length,
    fixCaught: caught,
    /** Pre-registered requirement: every gold fix leak labelled exactly fix_leak. */
    passes: caught === goldFix.length,
    agreement: pairs.filter((x) => x.gold === x.pred).length,
    n: pairs.length,
  };
}

export function confusionMarkdown(c: ReturnType<typeof confusion>): string {
  const head = `| gold \\ judge | ${LABELS.join(" | ")} |`;
  const sep = `|---|${LABELS.map(() => "---").join("|")}|`;
  const rows = LABELS.map((g) => `| **${g}** | ${LABELS.map((p) => (g === p ? `**${c.matrix[g][p]}**` : String(c.matrix[g][p]))).join(" | ")} |`);
  return [head, sep, ...rows].join("\n");
}
