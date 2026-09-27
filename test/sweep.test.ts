import { test } from "node:test";
import assert from "node:assert/strict";
import { expandGrid, pareto, type SweepPoint } from "../src/sweep.ts";
import type { PolicyThresholds } from "../src/config.ts";

const base: PolicyThresholds = {
  risky: 0.5,
  destructive: 0.5,
  underspecified: 0.6,
  needs_exploration: 0.6,
  scope_up: 2.5,
  scope_down: 0.5,
  task_type_conf: 0.5,
  scope_conf: 0.4,
  mass_coverage: 0,
};

test("expandGrid builds the cartesian product over base", () => {
  const g = expandGrid(base, { risky: [0.3, 0.7], scope_conf: [0.1, 0.2, 0.3] });
  assert.equal(g.length, 6);
  assert.ok(g.every((p) => p.destructive === 0.5));
  assert.deepEqual(new Set(g.map((p) => p.risky)), new Set([0.3, 0.7]));
});

test("expandGrid rejects unknown keys", () => {
  assert.throws(() => expandGrid(base, { riskyy: [1] }), /unknown threshold/);
});

test("pareto keeps only non-dominated points", () => {
  const pt = (spend: number, under_rate: number) => ({ spend, under_rate }) as SweepPoint;
  const front = pareto([pt(1, 0.5), pt(2, 0.2), pt(2, 0.4), pt(3, 0.2), pt(4, 0)]);
  assert.deepEqual(
    front.map((p) => [p.spend, p.under_rate]),
    [
      [1, 0.5],
      [2, 0.2],
      [4, 0],
    ],
  );
});
