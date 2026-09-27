/**
 * Style-variant assignment for rewrites: fixed seed, balanced within each stratum (counts differ
 * by at most 1), so a style can't cluster in one difficulty group. Uses only stratum and id.
 */
import { rng } from "../split.ts";

export function assignVariants(tasks: readonly { id: string; stratum: string }[], variants: readonly string[], seed: number): Map<string, string> {
  if (!variants.length) throw new Error("no style variants configured");
  const rand = rng(seed);
  const out = new Map<string, string>();
  const strata = [...new Set(tasks.map((t) => t.stratum))].sort();
  for (const s of strata) {
    const ids = tasks.filter((t) => t.stratum === s).map((t) => t.id).sort();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const offset = Math.floor(rand() * variants.length);
    ids.forEach((id, i) => out.set(id, variants[(i + offset) % variants.length]!));
  }
  return out;
}
