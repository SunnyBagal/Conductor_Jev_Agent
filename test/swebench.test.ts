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
