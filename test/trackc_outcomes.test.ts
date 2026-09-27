import { test } from "node:test";
import assert from "node:assert/strict";
import { cascadeLabelMismatches, cascadePrune, cell, cells, consistencyTest, inconsistencyTest, label, modelReport, patchStats, qualityByTier, signTestP, spendByTier, AttemptSchema, type Attempt, type AttemptStatus } from "../src/trackc/outcomes.ts";

const A = (task_id: string, tier: string, statuses: AttemptStatus[], extra: Partial<Attempt> = {}): Attempt[] =>
  statuses.map((status, i) =>
    AttemptSchema.parse({ task_id, arm: "casual", tier, model_id: tier, attempt: i + 1, status, started_at: "t", ...extra }),
  );
const ORDER = ["cheap", "standard", "top", "ceiling"];

test("cell: refusals, fallbacks and errors are excluded from valid attempts", () => {
  const c = cell(A("t", "top", ["pass", "refused", "pass"]));
  assert.deepEqual({ valid: c.valid, passes: c.passes, refused: c.refused, majority: c.majority, all: c.all }, { valid: 2, passes: 2, refused: 1, majority: true, all: true });
  assert.equal(cell(A("t", "top", ["pass", "fail", "fail"])).majority, false);
  assert.equal(cell(A("t", "top", ["pass", "pass", "fail"])).all, false);
  const u = cell(A("t", "top", ["pass", "error", "fallback"]));
  assert.equal(u.majority, null, "fewer than 2 valid attempts -> undetermined");
  assert.equal(u.fallback, 1);
  assert.equal(u.errors, 1);
});

test("labels: cheapest passing tier, majority vs all, unsolved and uncertain", () => {
  const byTier = cells([
    ...A("t", "cheap", ["pass", "fail", "fail"]),
    ...A("t", "standard", ["pass", "pass", "fail"]),
    ...A("t", "top", ["pass", "pass", "pass"]),
    ...A("t", "ceiling", ["pass", "pass", "pass"]),
  ]).get("t")!;
  assert.deepEqual(label(byTier, ORDER, "majority"), { tier: "standard", uncertain: false });
  assert.deepEqual(label(byTier, ORDER, "all"), { tier: "top", uncertain: false });
  const none = cells(ORDER.flatMap((t) => A("u", t, ["fail", "fail", "fail"]))).get("u")!;
  assert.deepEqual(label(none, ORDER, "majority"), { tier: "unsolved", uncertain: false });
  const unsure = cells([...A("v", "cheap", ["refused", "refused", "pass"]), ...A("v", "standard", ["pass", "pass", "pass"])]).get("v")!;
  assert.deepEqual(label(unsure, ORDER, "majority"), { tier: "standard", uncertain: true });
});

test("modelReport: rates, pass-count distribution, and refusals", () => {
  const all = cells([
    ...A("a", "top", ["pass", "pass", "pass"]),
    ...A("b", "top", ["pass", "fail", "fail"]),
    ...A("c", "top", ["fail", "fail", "fail"]),
    ...A("d", "top", ["pass", "refused", "pass"]),
  ]);
  const r = modelReport(all, "top", 3);
  assert.deepEqual(r.majority, { k: 2, n: 4 });
  assert.deepEqual(r.all, { k: 2, n: 4 });
  assert.deepEqual(r.dist, [1, 1, 0, 1], "d has only 2 valid attempts, so it is outside the 0/3..3/3 distribution");
  assert.equal(r.distN, 3);
  assert.equal(r.refused, 1);
});

test("sign test p-values", () => {
  assert.equal(signTestP(0, 0), 1);
  assert.ok(Math.abs(signTestP(10, 10) - 2 / 1024) < 1e-12);
  assert.ok(Math.abs(signTestP(5, 10) - 1) < 1e-9);
});

test("inconsistencyTest (secondary) compares inconsistent (1/3, 2/3) tasks on paired tasks", () => {
  const rows: Attempt[] = [];
  for (let i = 0; i < 8; i++) {
    rows.push(...A(`t${i}`, "ceiling", ["pass", "pass", "pass"]));
    rows.push(...A(`t${i}`, "top", ["pass", "fail", "pass"]));
  }
  rows.push(...A("x", "ceiling", ["pass", "fail", "fail"]), ...A("x", "top", ["pass", "pass", "pass"]));
  rows.push(...A("y", "ceiling", ["pass", "pass", "pass"]), ...A("y", "top", ["pass", "refused", "pass"]));
  const r = inconsistencyTest(cells(rows), "ceiling", "top", 3);
  assert.equal(r.n, 9, "y excluded: top has only 2 valid attempts");
  assert.equal(r.aOnlyConsistent, 8);
  assert.equal(r.bOnlyConsistent, 1);
  assert.ok(r.p < 0.05);
  assert.equal(r.supported, true);
});

test("patchStats counts files and changed lines, not headers", () => {
  const diff = ["diff --git a/x.py b/x.py", "--- a/x.py", "+++ b/x.py", "@@ -1 +1 @@", "-old", "+new", "diff --git a/y.py b/y.py", "+add"].join("\n");
  assert.deepEqual(patchStats(diff), { files: 2, lines: 3 });
});

test("spend and quality aggregate per arm and tier", () => {
  const rows = [
    ...A("a", "ceiling", ["pass"], { cost_usd: 2, patch: "diff --git a/x b/x\n+1\n" }),
    ...A("a", "top", ["fail"], { cost_usd: 1, p2p: { passed: 3, failed: 1 } }),
    ...A("b", "top", ["fail"], { cost_usd: null }),
  ];
  const s = spendByTier(rows);
  assert.equal(s.total, 3);
  assert.equal(s.byKey.get("casual:top")!.missing, 1);
  assert.deepEqual(qualityByTier(rows, "top").failingBrokeExistingTests, { k: 1, n: 1 });
  assert.equal(qualityByTier(rows, "ceiling").medianLines, 1);
});

test("modelReport: primary consistency = 3/3 among tasks passed at least once", () => {
  const all = cells([
    ...A("a", "top", ["pass", "pass", "pass"]),
    ...A("b", "top", ["pass", "fail", "fail"]),
    ...A("c", "top", ["fail", "fail", "fail"]),
  ]);
  assert.deepEqual(modelReport(all, "top", 3).allGivenAny, { k: 1, n: 2 }, "c never passed, so it is not in the denominator");
});

test("consistencyTest (primary): only tasks both passed at least once; inconclusive below N_min", () => {
  const rows: Attempt[] = [];
  for (let i = 0; i < 22; i++) {
    rows.push(...A(`t${i}`, "ceiling", ["pass", "pass", "pass"]));
    rows.push(...A(`t${i}`, "top", i < 20 ? ["pass", "fail", "pass"] : ["pass", "pass", "pass"]));
  }
  rows.push(...A("z", "ceiling", ["pass", "pass", "pass"]), ...A("z", "top", ["fail", "fail", "fail"]));
  const r = consistencyTest(cells(rows), "ceiling", "top", 3, 20);
  assert.equal(r.n, 22, "z excluded: top never passed");
  assert.deepEqual([r.aOnly, r.bOnly, r.both, r.discordant], [20, 0, 2, 20]);
  assert.equal(r.verdict, "supported");
  assert.equal(consistencyTest(cells(rows), "ceiling", "top", 3, 21).verdict, "inconclusive — 20 discordant tasks");
  const even = [...Array(12).keys()].flatMap((i) => [...A(`e${i}`, "ceiling", i % 2 ? ["pass", "pass", "pass"] : ["pass", "fail", "pass"]), ...A(`e${i}`, "top", i % 2 ? ["pass", "fail", "pass"] : ["pass", "pass", "pass"])]);
  assert.equal(consistencyTest(cells([...even, ...even.map((x) => ({ ...x, task_id: x.task_id + "b" }))]), "ceiling", "top", 3, 20).verdict, "not supported");
});

test("cascadePrune keeps only what the cascade design would have run", () => {
  const rows = [
    ...ORDER.flatMap((t) => A("easy", t, ["pass", "pass", "pass"])),
    ...A("mid", "cheap", ["pass", "fail", "pass"]), ...A("mid", "standard", ["pass", "pass", "pass"]), ...A("mid", "top", ["pass", "pass", "pass"]), ...A("mid", "ceiling", ["fail", "fail", "fail"]),
    ...A("hard", "cheap", ["fail", "fail", "fail"]), ...A("hard", "standard", ["pass", "refused", "pass"]), ...A("hard", "top", ["pass", "pass", "pass"]), ...A("hard", "ceiling", ["pass", "fail", "pass"]),
  ];
  const kept = cascadePrune(rows, ORDER, 3);
  const tiers = (t: string) => [...new Set(kept.filter((a) => a.task_id === t).map((a) => a.tier))];
  assert.deepEqual(tiers("easy"), ["cheap"]);
  assert.deepEqual(tiers("mid"), ["cheap", "standard"]);
  assert.deepEqual(tiers("hard"), ["cheap", "standard", "top", "ceiling"], "a refusal keeps standard below 3 passes, so it escalates");
  assert.deepEqual(cascadeLabelMismatches(rows, ORDER, 3), [], "labels identical by construction");
});
