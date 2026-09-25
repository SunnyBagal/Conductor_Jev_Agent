import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracyByConfidence, computeMetrics, fmt, relativeCost, selectBest, wilson, type Pair } from "../src/metrics.ts";
import type { Tier } from "../src/data.ts";

const P = (routed: Tier, label: Tier, sure: "yes" | "no" = "yes", confidence: number | null = null): Pair => ({
  id: `${routed}-${label}-${Math.random()}`,
  routed,
  label,
  sure,
  confidence,
});

const costs = { cheap: 1, standard: 3, frontier: 10, router_overhead: 0 };

test("fmt prints count and percentage together", () => {
  assert.equal(fmt({ k: 4, n: 60 }), "4/60 (6.7%)");
  assert.equal(fmt({ k: 0, n: 0 }), "0/0 (n/a)");
});

test("wilson interval is sane", () => {
  const [lo, hi] = wilson({ k: 0, n: 10 });
  assert.equal(lo, 0);
  assert.ok(hi > 0.25 && hi < 0.35);
  assert.deepEqual(wilson({ k: 0, n: 0 }), [0, 1]);
});

test("under/over/correct and confusion", () => {
  const m = computeMetrics(
    [P("cheap", "frontier"), P("standard", "standard"), P("frontier", "cheap"), P("cheap", "cheap", "no")],
    null,
  );
  assert.deepEqual(m.under, { k: 1, n: 4 });
  assert.deepEqual(m.over, { k: 1, n: 4 });
  assert.deepEqual(m.correct, { k: 2, n: 4 });
  assert.equal(m.confusion.frontier.cheap, 1);
  assert.equal(m.confusion.cheap.frontier, 1);
  assert.deepEqual(m.distribution.cheap, { k: 2, n: 4 });
  assert.deepEqual(m.sureNo.correct, { k: 1, n: 1 });
  assert.equal(m.relativeCost, null);
});

test("relative cost charges a re-run at the labeled tier for under-routing", () => {
  assert.equal(relativeCost([P("frontier", "cheap")], costs), 1);
  assert.equal(relativeCost([P("cheap", "cheap")], costs), 0.1);
  // cheap attempt (1) + frontier re-run (10) = 11 vs 10
  assert.equal(relativeCost([P("cheap", "frontier")], costs), 1.1);
  assert.equal(relativeCost([P("cheap", "cheap")], { ...costs, router_overhead: 1 }), 0.2);
});

test("accuracy by confidence buckets", () => {
  const b = accuracyByConfidence([P("cheap", "cheap", "yes", 0.95), P("cheap", "frontier", "yes", 0.3), P("cheap", "cheap", "yes", 1)]);
  assert.deepEqual(b[0]!.under, { k: 1, n: 1 });
  assert.deepEqual(b[3]!.correct, { k: 2, n: 2 });
});

test("selectBest: cheapest under the cap, else least under-routing", () => {
  const mk = (under: number, rank: number, name: string) => ({
    name,
    metrics: { ...computeMetrics([], null), under: { k: under, n: 10 }, correct: { k: 5, n: 10 }, meanTierRank: rank, relativeCost: null },
  });
  assert.equal(selectBest([mk(0, 2, "a"), mk(1, 1, "b"), mk(3, 0, "c")], 0.1).name, "b");
  assert.equal(selectBest([mk(5, 1, "a"), mk(3, 2, "b")], 0.1).name, "b");
});
