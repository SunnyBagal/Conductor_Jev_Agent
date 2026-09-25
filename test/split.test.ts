import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stratifiedSplit, runSplit } from "../src/split.ts";
import { paths, type Tier } from "../src/data.ts";

const mk = (n: Record<Tier, number>) =>
  (Object.entries(n) as [Tier, number][]).flatMap(([label, k]) =>
    Array.from({ length: k }, (_, i) => ({ id: `${label}-${i}`, label })),
  );

test("stratified split keeps label proportions", () => {
  const labels = mk({ cheap: 50, standard: 30, frontier: 20 });
  const { tune, test: tst } = stratifiedSplit(labels, 1, 0.4);
  assert.equal(tune.length + tst.length, 100);
  assert.equal(tst.filter((id) => id.startsWith("cheap")).length, 20);
  assert.equal(tst.filter((id) => id.startsWith("standard")).length, 12);
  assert.equal(tst.filter((id) => id.startsWith("frontier")).length, 8);
  assert.equal(new Set([...tune, ...tst]).size, 100, "no overlap");
});

test("split is deterministic for a seed and independent of input order", () => {
  const labels = mk({ cheap: 10, standard: 10, frontier: 10 });
  const a = stratifiedSplit(labels, 42, 0.4);
  assert.deepEqual(a, stratifiedSplit([...labels].reverse(), 42, 0.4));
  assert.notDeepEqual(a, stratifiedSplit(labels, 43, 0.4));
});

function dataset(rows: string) {
  const dir = mkdtempSync(join(tmpdir(), "jre-"));
  writeFileSync(join(dir, "labels.csv"), "id,prompt,label,sure\n" + rows);
  return paths(dir);
}

test("runSplit refuses to overwrite without --force", () => {
  const p = dataset("a,x,cheap,yes\nb,y,frontier,no\n");
  const o = { seed: 1, testFraction: 0.5, force: false, extend: false };
  runSplit(p, o);
  assert.throws(() => runSplit(p, o), /already exists/);
  assert.doesNotThrow(() => runSplit(p, { ...o, force: true }));
});

test("runSplit --extend keeps old assignments and adds new ids", () => {
  const p = dataset(Array.from({ length: 10 }, (_, i) => `c${i},p,cheap,yes\n`).join(""));
  const first = runSplit(p, { seed: 1, testFraction: 0.4, force: false, extend: false });
  appendFileSync(p.labels, Array.from({ length: 5 }, (_, i) => `n${i},p,standard,yes\n`).join(""));
  const second = runSplit(p, { seed: 1, testFraction: 0.4, force: false, extend: true });
  for (const id of first.test) assert.ok(second.test.includes(id));
  for (const id of first.tune) assert.ok(second.tune.includes(id));
  assert.equal(second.tune.length + second.test.length, 15);
});
