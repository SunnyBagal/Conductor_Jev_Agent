import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapestResolvingTier } from "../src/swebench.ts";

test("cheapestResolvingTier returns the lowest tier where any submission resolved it", () => {
  const byTier = {
    cheap: [new Set(["a"]), new Set<string>()],
    standard: [new Set(["a", "b"])],
    frontier: [new Set(["a", "b", "c"])],
  };
  assert.equal(cheapestResolvingTier("a", byTier), "cheap");
  assert.equal(cheapestResolvingTier("b", byTier), "standard");
  assert.equal(cheapestResolvingTier("c", byTier), "frontier");
  assert.equal(cheapestResolvingTier("d", byTier), null);
});

test("compareRules scores each uncertainty rule on solved instances only", async () => {
  const { compareRules, RULE_VARIANTS } = await import("../src/swebench.ts");
  const { hashAnswers } = await import("../src/decider.ts");
  const { loadThresholds } = await import("../src/config.ts");
  const rows = [
    { id: "a", answers: hashAnswers("a"), cheapest: "cheap" as const },
    { id: "b", answers: hashAnswers("b"), cheapest: "frontier" as const },
    { id: "c", answers: hashAnswers("c"), cheapest: null },
  ];
  const out = compareRules(rows, loadThresholds().policy, null);
  assert.equal(out.length, RULE_VARIANTS.length);
  for (const r of out) assert.equal(r.under.n, 2);
  assert.equal(out[0]!.rule, "confidence round-up");
});
