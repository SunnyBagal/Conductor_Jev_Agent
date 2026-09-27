/**
 * Deterministic typo injection for the `typo` variant (r3): lowercase the prose and apply 1–3
 * adjacent-character swaps or drops to plain words. Never touches backticked code, identifiers
 * (anything with _ . ( ) / digits or inner capitals), or names from the Stage 1 facts.
 */
import { createHash } from "node:crypto";
import { rng } from "../split.ts";

export interface TypoEdit {
  word: string;
  result: string;
  op: "swap" | "drop";
}

export const typoSeed = (variantSeed: number, taskId: string) =>
  parseInt(createHash("sha256").update(`${variantSeed}:${taskId}`).digest("hex").slice(0, 8), 16);

const PLAIN = /^[A-Za-z]{4,}$/;

export function applyTypos(
  text: string,
  seed: number,
  protectedNames: readonly string[],
  o: { min: number; max: number; lowercase: boolean },
): { text: string; edits: TypoEdit[] } {
  const rand = rng(seed);
  const protect = new Set(protectedNames.flatMap((n) => n.toLowerCase().split(/[^a-z0-9_]+/)).filter(Boolean));
  // Split into code spans (kept verbatim) and prose.
  const parts = text.split(/(`[^`]*`)/);
  const prose = parts.map((p) => (p.startsWith("`") && p.endsWith("`") && p.length > 1 ? null : o.lowercase ? p.toLowerCase() : p));
  // Candidate words: plain alphabetic tokens in prose, not protected.
  const cands: { part: number; start: number; word: string }[] = [];
  prose.forEach((p, i) => {
    if (p === null) return;
    for (const m of p.matchAll(/\S+/g)) {
      const core = m[0].replace(/[.,!?;:]+$/, "");
      if (PLAIN.test(core) && !protect.has(core.toLowerCase())) cands.push({ part: i, start: m.index!, word: core });
    }
  });
  const want = Math.min(cands.length, o.min + Math.floor(rand() * (o.max - o.min + 1)));
  const chosen: typeof cands = [];
  const pool = [...cands];
  while (chosen.length < want && pool.length) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  // Apply right-to-left within each part so offsets stay valid.
  chosen.sort((a, b) => a.part - b.part || b.start - a.start);
  const edits: TypoEdit[] = [];
  for (const c of chosen) {
    const w = c.word;
    const swap = rand() < 0.5;
    let result: string;
    if (swap) {
      const i = 1 + Math.floor(rand() * (w.length - 2)); // swap i and i+1, keep first letter
      result = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
    } else {
      const i = 1 + Math.floor(rand() * (w.length - 1)); // drop a non-first letter
      result = w.slice(0, i) + w.slice(i + 1);
    }
    if (result === w) result = w.slice(0, 1) + w.slice(2); // swapping identical letters: drop instead
    const p = prose[c.part]!;
    prose[c.part] = p.slice(0, c.start) + result + p.slice(c.start + w.length);
    edits.push({ word: w, result, op: swap && result.length === w.length ? "swap" : "drop" });
  }
  return { text: parts.map((p, i) => prose[i] ?? p).join(""), edits: edits.reverse() };
}
