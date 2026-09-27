import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTypos, typoSeed } from "../src/trackc/typos.ts";

const o = { min: 1, max: 3, lowercase: true };
const text = "The `SparseCoder.transform()` Method raises ValueError when calling transform with lasso_cd on Windows machines today";

test("typos: deterministic per seed, 1-3 edits, lowercase prose", () => {
  const a = applyTypos(text, 42, [], o);
  assert.deepEqual(a, applyTypos(text, 42, [], o));
  assert.ok(a.edits.length >= 1 && a.edits.length <= 3, `${a.edits.length}`);
  assert.ok(a.text.startsWith("the "), "prose lowercased");
  assert.notEqual(a.text, text.toLowerCase(), "at least one edit applied");
});

test("typos never touch code spans, identifiers, or protected names", () => {
  for (let seed = 0; seed < 200; seed++) {
    const r = applyTypos(text, seed, ["ValueError", "windows"], o);
    assert.ok(r.text.includes("`SparseCoder.transform()`"), "code span verbatim, case kept");
    assert.ok(r.text.includes("lasso_cd"), "identifier with underscore untouched");
    assert.ok(r.text.includes("valueerror"), "protected name untouched (lowercased only)");
    assert.ok(r.text.includes("windows"), "protected name untouched");
    for (const e of r.edits) assert.ok(/^[a-z]{4,}$/i.test(e.word) && Math.abs(e.word.length - e.result.length) <= 1);
  }
});

test("typoSeed is stable per task", () => {
  assert.equal(typoSeed(1, "a"), typoSeed(1, "a"));
  assert.notEqual(typoSeed(1, "a"), typoSeed(1, "b"));
});

test("no candidates -> no edits, text unchanged apart from case", () => {
  assert.deepEqual(applyTypos("`x` and `y`", 1, [], o), { text: "`x` and `y`", edits: [] });
});
