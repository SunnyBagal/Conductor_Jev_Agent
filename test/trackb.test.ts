import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadeAttempts, opusOnly, scaffoldFlags, scoreAllTasks, scoreCascade, scoreRouter, solvedAt, type LadderData, type SubMeta } from "../src/trackb.ts";

// Task a: all solve. b: only standard+frontier. c: only frontier. d: only cheap (non-monotonic). e: nobody.
const L: LadderData = {
  name: "test",
  tiers: {
    cheap: { model: "h", submissions: [], resolved: new Set(["a", "d"]), cost: new Map([["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1]]), price: 1 },
    standard: { model: "s", submissions: [], resolved: new Set(["a", "b"]), cost: new Map([["a", 2], ["b", 2], ["c", 2], ["d", 2], ["e", 2]]), price: 3 },
    frontier: { model: "o", submissions: [], resolved: new Set(["a", "b", "c"]), cost: new Map([["a", 4], ["b", 4], ["c", 4], ["d", 4], ["e", 4]]), price: 5 },
  },
};

test("solvedAt / opusOnly", () => {
  assert.equal(solvedAt(L, "a"), "cheap");
  assert.equal(solvedAt(L, "c"), "frontier");
  assert.equal(solvedAt(L, "e"), null);
  assert.ok(opusOnly(L, "c"));
  assert.ok(!opusOnly(L, "b"));
});

test("cascade stops at the first tier that resolved it, and pays every tier when nobody did", () => {
  assert.deepEqual(cascadeAttempts(L, "a"), ["cheap"]);
  assert.deepEqual(cascadeAttempts(L, "b"), ["cheap", "standard"]);
  assert.deepEqual(cascadeAttempts(L, "c"), ["cheap", "standard", "frontier"]);
  assert.deepEqual(cascadeAttempts(L, "e"), ["cheap", "standard", "frontier"]);
});

test("scoreRouter: always-standard on solved ids, with first-try success and re-run cost", () => {
  const s = scoreRouter(L, ["a", "b", "c", "d", "e"], "std", () => "standard");
  assert.equal(s.n, 4, "e is unsolved and excluded");
  assert.deepEqual(s.under, { k: 1, n: 4 }, "c needs frontier");
  assert.deepEqual(s.firstTry, { k: 2, n: 4 }, "d: cheap solved it but standard did not");
  // est: 4 x 3 (standard) + 5 (c re-run at frontier) = 17 over 4 x 5
  assert.equal(s.relVsFrontier, 17 / 20);
  // measured: 4 x 2 + 4 (c re-run) = 12 / 4
  assert.equal(s.usdPerTask, 3);
  assert.equal(s.runsPerTask, 5 / 4);
});

test("scoreCascade never under-routes and pays for every attempt", () => {
  const c = scoreCascade(L, ["a", "b", "c", "d", "e"]);
  assert.equal(c.n, 4);
  assert.deepEqual(c.under, { k: 0, n: 4 });
  // est: a 1, b 1+3, c 1+3+5, d 1 = 15 over 4 x 5
  assert.equal(c.relVsFrontier, 15 / 20);
  // measured: a 1, b 3, c 7, d 1 = 12 / 4
  assert.equal(c.usdPerTask, 3);
  assert.equal(c.runsPerTask, 7 / 4);
  assert.deepEqual(c.dist, { cheap: 2, standard: 1, frontier: 1 });
});

test("scoreAllTasks includes unsolved tasks", () => {
  const c = scoreAllTasks(L, ["a", "e"], "cascade", (id) => cascadeAttempts(L, id));
  assert.deepEqual(c.resolved, { k: 1, n: 2 });
  assert.equal(c.relVsFrontier, (1 + 9) / 10);
});

test("scaffoldFlags flags mixed dates, versions and non-pass@1", () => {
  const m = (o: Partial<SubMeta>): SubMeta => ({ submission: "x", tier: "cheap", date: "20250522", agent: "Tools", version: "—", attempts: "1", modelTag: "m", ...o });
  assert.deepEqual(scaffoldFlags([m({}), m({ tier: "standard" })]), []);
  const f = scaffoldFlags([m({ date: "20241022", attempts: "2+", submission: "h" }), m({ tier: "standard" })]);
  assert.ok(f.some((x) => /different dates/.test(x)));
  assert.ok(f.some((x) => /h is not pass@1/.test(x)));
});
