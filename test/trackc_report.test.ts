import { test } from "node:test";
import assert from "node:assert/strict";
import { pilotReport } from "../src/trackc/report.ts";
import { AttemptSchema, type Attempt } from "../src/trackc/outcomes.ts";

const run = (task_id: string, tier: string, attempt: number, status: Attempt["status"], cost: number | null, arm: Attempt["arm"] = "casual") =>
  AttemptSchema.parse({ task_id, arm, tier, model_id: tier, attempt, status, cost_usd: cost, wall_s: 60 * attempt, started_at: "t" });

test("pilot report: per-model rows, spend shares, projection, control arm", () => {
  const attempts: Attempt[] = [];
  for (const t of ["t1", "t2"])
    for (let i = 1; i <= 3; i++) {
      attempts.push(run(t, "cheap", i, "fail", 0.1));
      attempts.push(run(t, "standard", i, "pass", 0.2));
      attempts.push(run(t, "top", i, i === 3 ? "refused" : "pass", 0.3));
      attempts.push(run(t, "ceiling", i, "pass", i === 1 ? null : 1.4));
      attempts.push(run(t, "standard", i, "pass", 0.2, "original"));
    }
  const md = pilotReport({ attempts, tierOrder: ["cheap", "standard", "top", "ceiling"], tierNames: { ceiling: "Fable 5.1" }, attemptsPerModel: 3, fullRunTasks: 200 });
  assert.match(md, /\| top \| 6 \|.*\| 2\/2 \(100\.0%\) \|.*\| 2 \| 0 \| 0 \|/, "refusals counted, excluded from pass rate");
  assert.match(md, /Fable 5\.1's share: 54%/, "5.6 of 10.4 total");
  assert.match(md, /2 run\(s\) reported no cost/);
  assert.match(md, /200 tasks → \*\*\$920\.00\*\*/, "casual $9.20 over 2 tasks = $4.60/task");
  assert.match(md, /majority pass 2\/2 \(100\.0%\), vs 2\/2 \(100\.0%\)/);
});
