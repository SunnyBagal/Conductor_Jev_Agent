/**
 * r3 two-stage rewrite.
 *  Stage 1: original issue -> symptom facts (strict JSON, no cause/fix fields exist).
 *  Stage 2: facts JSON + style line -> casual message. Stage 2 never receives the issue text:
 *           rewriteFromFacts() takes only Facts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const FactsSchema = z.object({
  user_action: z.string(),
  observed_behavior: z.string(),
  expected_behavior: z.string().nullable(),
  reproduction: z.string().nullable(),
  symptom_locations: z.array(z.string()),
});
export type Facts = z.infer<typeof FactsSchema>;

export interface ModelSettings {
  model: string;
  temperature: number;
  maxTokens: number;
  instruction: string;
}

export async function extractFacts(client: Anthropic, issueText: string, s: ModelSettings) {
  const res = await client.messages.parse({
    model: s.model,
    max_tokens: s.maxTokens,
    temperature: s.temperature,
    system: s.instruction,
    messages: [{ role: "user", content: `<bug_report>\n${issueText}\n</bug_report>` }],
    output_config: { format: zodOutputFormat(FactsSchema) },
  });
  if (res.stop_reason === "refusal") throw new Error("stage 1 refused");
  if (res.stop_reason === "max_tokens") throw new Error("stage 1 hit max_tokens");
  if (!res.parsed_output) throw new Error("stage 1 returned no parseable JSON");
  return { facts: res.parsed_output, model: res.model, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

/** Stage 2: input is the facts JSON only. */
export async function rewriteFromFacts(client: Anthropic, facts: Facts, s: ModelSettings) {
  const res = await client.messages.create({
    model: s.model,
    max_tokens: s.maxTokens,
    temperature: s.temperature,
    system: s.instruction,
    messages: [{ role: "user", content: `<bug_facts>\n${JSON.stringify(facts, null, 2)}\n</bug_facts>` }],
  });
  if (res.stop_reason === "refusal") throw new Error("stage 2 refused");
  if (res.stop_reason === "max_tokens") throw new Error("stage 2 hit max_tokens");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
  if (!text) throw new Error("stage 2 empty");
  return { text, model: res.model, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

/** Style line for a task; file_mention gets its allowed names filled in. */
export function styleLine(template: string, facts: Facts): string {
  return template.replace("{symptom_locations}", facts.symptom_locations.length ? facts.symptom_locations.map((n) => `\`${n}\``).join(", ") : "(none)");
}

/**
 * Names in the rewrite that are not in the facts JSON: backticked spans, dotted/underscored
 * identifiers, file paths, and CamelCase words. Recorded per rewrite; the judge is primary.
 */
export function namesOutsideFacts(rewrite: string, facts: Facts): string[] {
  const hay = JSON.stringify(facts).toLowerCase();
  const found = new Set<string>();
  for (const m of rewrite.matchAll(/`([^`]+)`/g)) found.add(m[1]!);
  for (const m of rewrite.matchAll(/\b[\w./-]*(?:_|\.py\b|[a-z][A-Z])[\w./-]*\b/g)) found.add(m[0]);
  return [...found].filter((n) => {
    const core = n.replace(/\(.*$/, "").replace(/[.,;:]+$/, "");
    return core.length > 2 && !hay.includes(core.toLowerCase());
  });
}
