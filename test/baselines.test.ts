import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordRoute, lengthRoute, tuneLength } from "../src/baselines.ts";
import type { Label, Task, Tier } from "../src/data.ts";

test("lengthRoute uses half-open cutoffs", () => {
  assert.equal(lengthRoute("x".repeat(39), [40, 200]).tier, "cheap");
  assert.equal(lengthRoute("x".repeat(40), [40, 200]).tier, "standard");
  assert.equal(lengthRoute("x".repeat(200), [40, 200]).tier, "frontier");
});

test("keywordRoute: risky words beat cheap words", () => {
  assert.equal(keywordRoute("fix typo in README").tier, "cheap");
  assert.equal(keywordRoute("fix typo in the auth docs").tier, "frontier");
  assert.equal(keywordRoute("add a dark mode toggle").tier, "standard");
  assert.equal(keywordRoute("why is CI flaky").tier, "frontier");
});

test("tuneLength picks cutoffs that meet the under-routing cap on the tune ids only", () => {
  const mk = (id: string, len: number, label: Tier): [Task, Label] => {
    const prompt = "x".repeat(len);
    return [{ id, prompt, source: "own" }, { id, prompt, label, sure: "yes" }];
  };
  const data = [mk("a", 10, "cheap"), mk("b", 100, "standard"), mk("c", 500, "frontier"), mk("t", 10, "frontier")];
  const tasks = data.map((d) => d[0]);
  const labels = new Map(data.map((d) => [d[1].id, d[1]]));
  // "t" is a test item that would punish short cutoffs; it must not influence tuning.
  const best = tuneLength(tasks, labels, ["a", "b", "c"], [40, 200, 800], 0, null);
  assert.deepEqual(best.cutoffs, [40, 200]);
  assert.equal(best.metrics.n, 3);
});
