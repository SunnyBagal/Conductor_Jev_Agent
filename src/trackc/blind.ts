/**
 * Blind A/B review: tasks where BOTH models had a majority pass. For each, take each model's
 * first passing patch, scrub model-identifying words, and randomize which one is A.
 * Review files show no model names; the key is written separately (git-ignored).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, writeJson } from "../data.ts";
import { rng } from "../split.ts";
import type { Attempt, Cell } from "./outcomes.ts";

const IDENTIFYING = /\b(claude|anthropic|opus|fable|sonnet|haiku)\b/gi;

export function scrub(patch: string): { text: string; redactions: number } {
  let redactions = 0;
  const text = patch.replace(IDENTIFYING, () => {
    redactions++;
    return "[redacted]";
  });
  return { text, redactions };
}

export interface BlindItem {
  n: number;
  task_id: string;
  A: string;
  B: string;
  key: { A: string; B: string; redactions: { A: number; B: number } };
}

export function pickBlind(
  attempts: readonly Attempt[],
  all: Map<string, Map<string, Cell>>,
  models: readonly [string, string],
  count: number,
  seed: number,
): BlindItem[] {
  const [m1, m2] = models;
  const firstPass = (task: string, tier: string) =>
    attempts
      .filter((a) => a.arm === "casual" && a.task_id === task && a.tier === tier && a.status === "pass")
      .sort((x, y) => x.attempt - y.attempt)[0];
  const eligible = [...all.entries()]
    .filter(([, m]) => m.get(m1)?.majority === true && m.get(m2)?.majority === true)
    .map(([t]) => t)
    .filter((t) => firstPass(t, m1) && firstPass(t, m2))
    .sort();
  const rand = rng(seed);
  const chosen = eligible.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).slice(0, count).map((x) => x.t);
  return chosen.map((task_id, i) => {
    const p1 = scrub(firstPass(task_id, m1)!.patch);
    const p2 = scrub(firstPass(task_id, m2)!.patch);
    const flip = rand() < 0.5;
    return {
      n: i + 1,
      task_id,
      A: flip ? p2.text : p1.text,
      B: flip ? p1.text : p2.text,
      key: { A: flip ? m2 : m1, B: flip ? m1 : m2, redactions: { A: flip ? p2.redactions : p1.redactions, B: flip ? p1.redactions : p2.redactions } },
    };
  });
}

export function writeBlind(items: readonly BlindItem[], prompts: Map<string, string>, outDir = "reviews/blind", keyFile = "data/private/blind_key.json") {
  ensureDir(outDir);
  for (const it of items) {
    const body = [
      `# Blind review ${it.n}: \`${it.task_id}\`\n`,
      `**Task as the agent saw it:**\n\n> ${(prompts.get(it.task_id) ?? "").replace(/\n/g, "\n> ")}\n`,
      `Both patches passed the hidden tests on a majority of attempts. Which is better, and why?\n`,
      `## Patch A\n\n\`\`\`diff\n${it.A}\n\`\`\`\n`,
      `## Patch B\n\n\`\`\`diff\n${it.B}\n\`\`\`\n`,
      `**Your verdict:** A / B / tie. Reason:\n`,
    ].join("\n");
    writeFileSync(join(outDir, `${String(it.n).padStart(2, "0")}.md`), body);
  }
  writeJson(keyFile, items.map((it) => ({ n: it.n, task_id: it.task_id, ...it.key })));
}
