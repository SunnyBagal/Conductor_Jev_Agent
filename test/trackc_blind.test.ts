import { test } from "node:test";
import assert from "node:assert/strict";
import { pickBlind, scrub } from "../src/trackc/blind.ts";
import { AttemptSchema, cells, type Attempt, type AttemptStatus } from "../src/trackc/outcomes.ts";

const A = (task_id: string, tier: string, statuses: AttemptStatus[], patch = `patch-${tier}`): Attempt[] =>
  statuses.map((status, i) => AttemptSchema.parse({ task_id, arm: "casual", tier, model_id: tier, attempt: i + 1, status, patch: `${patch}-${i + 1}`, started_at: "t" }));

test("scrub redacts model-identifying words", () => {
  assert.deepEqual(scrub("# written by Claude Opus\nx = 1"), { text: "# written by [redacted] [redacted]\nx = 1", redactions: 2 });
});

test("pickBlind: only tasks where both models majority-pass; first passing patch; A/B randomized; key complete", () => {
  const rows = [
    ...A("t1", "top", ["fail", "pass", "pass"]),
    ...A("t1", "ceiling", ["pass", "pass", "fail"]),
    ...A("t2", "top", ["pass", "fail", "fail"]),
    ...A("t2", "ceiling", ["pass", "pass", "pass"]),
    ...Array.from({ length: 20 }, (_, i) => [...A(`u${i}`, "top", ["pass", "pass", "pass"]), ...A(`u${i}`, "ceiling", ["pass", "pass", "pass"])]).flat(),
  ];
  const items = pickBlind(rows, cells(rows), ["top", "ceiling"], 15, 7);
  assert.equal(items.length, 15);
  assert.ok(!items.some((i) => i.task_id === "t2"), "top did not majority-pass t2");
  for (const it of items) {
    assert.deepEqual(new Set([it.key.A, it.key.B]), new Set(["top", "ceiling"]));
    if (it.task_id.startsWith("u")) assert.equal(it.A, `patch-${it.key.A}-1`);
  }
  assert.ok(items.some((i) => i.key.A === "top") && items.some((i) => i.key.A === "ceiling"), "order is randomized");
  assert.deepEqual(pickBlind(rows, cells(rows), ["top", "ceiling"], 15, 7), items, "deterministic for a seed");
  const t1 = pickBlind(rows.filter((r) => r.task_id === "t1"), cells(rows), ["top", "ceiling"], 5, 1)[0]!;
  assert.equal(t1.key.A === "top" ? t1.A : t1.B, "patch-top-2", "first PASSING attempt, not attempt 1");
});
