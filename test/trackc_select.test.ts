import { test } from "node:test";
import assert from "node:assert/strict";
import { cappedTake, selectTasks, stratumOf, type TrackCConfig } from "../src/trackc/select.ts";

const cfg: TrackCConfig = {
  seed: 1,
  repo_cap: 0.5,
  prior_ladder: { haiku: "h", sonnet: "s", opus: "o" },
  allocation: { A_haiku_easy: 4, A_haiku_hard: 0, B_sonnet: 10, C_opus: 0, D_none_easy: 0, D_none_hard: 0 },
  pilot_per_group: { A_haiku_easy: 1, A_haiku_hard: 0, B_sonnet: 2, C_opus: 0, D_none_easy: 0, D_none_hard: 0 },
  rewrite: { prompt_version: "r1", max_tokens: 100, instruction: "x".repeat(30) },
  tier_order: ["cheap", "standard", "top", "ceiling"],
  attempts: 3,
};

const pool = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `django__a-${i}`, difficulty: "<15 min fix" })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `sympy__a-${i}`, difficulty: "<15 min fix" })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `flask__b-${i}`, difficulty: "1-4 hours" })),
];
const prior = {
  haiku: new Set(pool.filter((x) => x.id.includes("__a-")).map((x) => x.id)),
  sonnet: new Set(pool.filter((x) => x.id.includes("__b-")).map((x) => x.id)),
  opus: new Set<string>(),
};

test("stratumOf uses prior outcome first, then human difficulty", () => {
  assert.equal(stratumOf({ id: "django__a-0", difficulty: "<15 min fix" }, prior), "A_haiku_easy");
  assert.equal(stratumOf({ id: "flask__b-0", difficulty: "1-4 hours" }, prior), "B_sonnet");
  assert.equal(stratumOf({ id: "x__z", difficulty: "1-4 hours" }, prior), "D_none_hard");
  assert.equal(stratumOf({ id: "x__z", difficulty: "<15 min fix" }, prior), "D_none_easy");
});

test("selectTasks: allocation, take-all when the pool is small, weights, pilot flags", () => {
  const rows = selectTasks(pool, prior, cfg);
  const a = rows.filter((r) => r.stratum === "A_haiku_easy");
  const b = rows.filter((r) => r.stratum === "B_sonnet");
  assert.equal(a.length, 4);
  assert.equal(b.length, 3, "only 3 in the pool, so all are taken");
  assert.equal(a[0]!.weight, 12 / 4);
  assert.equal(b[0]!.weight, 1);
  assert.equal(a.filter((r) => r.pilot).length, 1);
  assert.equal(b.filter((r) => r.pilot).length, 2);
});

test("selectTasks is deterministic for a seed and ignores input order", () => {
  assert.deepEqual(selectTasks(pool, prior, cfg), selectTasks([...pool].reverse(), prior, cfg));
  assert.notDeepEqual(selectTasks(pool, prior, cfg), selectTasks(pool, prior, { ...cfg, seed: 2 }));
});

test("repo cap limits any one repo, and fills from skipped items only if needed", () => {
  const rows = selectTasks(pool, prior, cfg).filter((r) => r.stratum === "A_haiku_easy");
  assert.ok(rows.filter((r) => r.repo === "django").length <= 2, "cap = ceil(0.5 * 4) = 2");
  const onlyDjango = Array.from({ length: 5 }, (_, i) => ({ id: `django__${i}` }));
  assert.equal(cappedTake(onlyDjango, 3, 0.35).length, 3, "fills from skipped when one repo is all there is");
});
