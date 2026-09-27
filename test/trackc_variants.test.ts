import { test } from "node:test";
import assert from "node:assert/strict";
import { assignVariants } from "../src/trackc/variants.ts";

const V = ["terse", "typo", "file_mention", "rambly"];
const tasks = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, stratum: "A" })),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, stratum: "B" })),
];

test("assignVariants is deterministic, covers every task, and balances within strata", () => {
  const m = assignVariants(tasks, V, 1);
  assert.equal(m.size, tasks.length);
  assert.deepEqual(m, assignVariants([...tasks].reverse(), V, 1), "input order does not matter");
  assert.notDeepEqual(m, assignVariants(tasks, V, 2));
  for (const s of ["A", "B"]) {
    const counts = V.map((v) => tasks.filter((t) => t.stratum === s && m.get(t.id) === v).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${s}: ${counts}`);
  }
});
