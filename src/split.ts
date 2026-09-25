import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readJson, readLabelsCsv, SplitSchema, TIERS, writeJson, type Label, type Paths, type Split } from "./data.ts";

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Stratified by label; deterministic for a given seed and id set (input order does not matter). */
export function stratifiedSplit(labels: Pick<Label, "id" | "label">[], seed: number, testFraction: number) {
  const rand = rng(seed);
  const tune: string[] = [];
  const test: string[] = [];
  for (const tier of TIERS) {
    const ids = labels.filter((l) => l.label === tier).map((l) => l.id).sort();
    const shuffled = shuffle(ids, rand);
    const nTest = Math.round(ids.length * testFraction);
    test.push(...shuffled.slice(0, nTest));
    tune.push(...shuffled.slice(nTest));
  }
  return { tune: tune.sort(), test: test.sort() };
}

export const fileSha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export interface SplitOptions {
  seed: number;
  testFraction: number;
  force: boolean;
  extend: boolean;
}

export function runSplit(p: Paths, o: SplitOptions): Split {
  const labels = readLabelsCsv(p.labels);
  if (!labels.length) throw new Error(`${p.labels} has no rows`);
  const exists = existsSync(p.split);

  if (exists && o.extend) {
    const old = readJson(p.split, SplitSchema);
    const known = new Set([...old.tune, ...old.test]);
    const fresh = labels.filter((l) => !known.has(l.id));
    // Different seed stream per extension so new ids aren't assigned in lockstep with the original split.
    const add = stratifiedSplit(fresh, old.seed + known.size, old.test_fraction);
    const split: Split = {
      ...old,
      labels_sha256: fileSha256(p.labels),
      tune: [...old.tune, ...add.tune].sort(),
      test: [...old.test, ...add.test].sort(),
    };
    writeJson(p.split, split);
    console.log(`Extended ${p.split}: +${add.tune.length} tune, +${add.test.length} test (existing assignments unchanged).`);
    return split;
  }

  if (exists && !o.force)
    throw new Error(
      `${p.split} already exists. Re-splitting leaks test items into tuning. ` +
        `Use --extend to assign only new ids, or --force to overwrite anyway.`,
    );

  const { tune, test } = stratifiedSplit(labels, o.seed, o.testFraction);
  const split: Split = {
    seed: o.seed,
    test_fraction: o.testFraction,
    labels_sha256: fileSha256(p.labels),
    created_at: new Date().toISOString(),
    tune,
    test,
  };
  writeJson(p.split, split);
  console.log(`Wrote ${p.split}: ${tune.length} tune / ${test.length} test (seed ${o.seed}).`);
  return split;
}

export function loadSplit(p: Paths): Split {
  if (!existsSync(p.split)) throw new Error(`${p.split} not found. Run \`split\` first.`);
  const s = readJson(p.split, SplitSchema);
  if (existsSync(p.labels) && fileSha256(p.labels) !== s.labels_sha256)
    console.warn(`warning: ${p.labels} changed since the split was made. New ids are ignored until you run \`split --extend\`.`);
  return s;
}
