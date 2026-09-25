import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, readLabelsCsv, paths, tierAt, maxTier } from "../src/data.ts";

test("parseCsv handles quotes, escaped quotes, commas and newlines", () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n');
  assert.deepEqual(rows, [
    ["a", "b"],
    ["x, y", 'say "hi"\nthere'],
  ]);
});

test("parseCsv strips BOM and ignores blank trailing lines", () => {
  assert.deepEqual(parseCsv("﻿id\n1\n\n"), [["id"], ["1"]]);
});

test("parseCsv rejects unterminated quotes", () => {
  assert.throws(() => parseCsv('a\n"oops'), /unterminated/);
});

const tmp = (content: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "jre-")), "labels.csv");
  writeFileSync(f, content);
  return f;
};

test("readLabelsCsv normalizes case and validates", () => {
  const f = tmp('id,prompt,label,sure\nt1,"fix, typo",Cheap,YES\n');
  assert.deepEqual(readLabelsCsv(f), [{ id: "t1", prompt: "fix, typo", label: "cheap", sure: "yes" }]);
});

test("readLabelsCsv rejects bad label, bad header, duplicates", () => {
  assert.throws(() => readLabelsCsv(tmp("id,prompt,label,sure\nt1,p,medium,yes\n")), /row 2/);
  assert.throws(() => readLabelsCsv(tmp("id,label,prompt,sure\n")), /header/);
  assert.throws(() => readLabelsCsv(tmp("id,prompt,label,sure\nt1,p,cheap,yes\nt1,p,cheap,no\n")), /duplicate/);
});

test("paths isolates non-default data dirs", () => {
  assert.equal(paths("data").runsDir, "runs");
  assert.equal(paths("data/").reportsDir, "reports");
  assert.equal(paths("data/fixtures").runsDir, join("runs", "data_fixtures"));
});

test("tier helpers clamp", () => {
  assert.equal(tierAt(5), "frontier");
  assert.equal(tierAt(-1), "cheap");
  assert.equal(maxTier("cheap", "standard"), "standard");
});
