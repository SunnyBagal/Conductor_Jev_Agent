import { test } from "node:test";
import assert from "node:assert/strict";
import { modalUsd, pilotReport, project } from "../src/trackc/report.ts";
import { AttemptSchema, cascadePrune, type Attempt } from "../src/trackc/outcomes.ts";

const run = (task_id: string, tier: string, attempt: number, status: Attempt["status"], cost: number | null, arm: Attempt["arm"] = "casual") =>
  AttemptSchema.parse({ task_id, arm, tier, model_id: tier, attempt, status, cost_usd: cost, wall_s: 600, cost_source: cost === null ? "none" : "claude_code", started_at: "t" });

const ORDER = ["cheap", "standard", "top", "ceiling"];
const compute = { usd_per_core_second: 0.0001, usd_per_gib_second: 0, assumed_cores: 1, assumed_gib: 4 };

function pilot(): Attempt[] {
  const out: Attempt[] = [];
  for (const t of ["t1", "t2"])
    for (let i = 1; i <= 3; i++) {
      out.push(run(t, "cheap", i, "fail", 0.1));
      out.push(run(t, "standard", i, "pass", 0.2));
      out.push(run(t, "top", i, i === 3 ? "refused" : "pass", 0.3));
      out.push(run(t, "ceiling", i, "pass", i === 1 ? null : 1.4));
      out.push(run(t, "standard", i, "pass", 0.2, "original"));
    }
  return out;
}

const inputs = (attempts: Attempt[]) => ({
  attempts,
  tierOrder: ORDER,
  tierNames: { ceiling: "Fable 5.1", top: "Opus 5.5" },
  attemptsPerModel: 3,
  stratumOf: new Map([["t1", "A"], ["t2", "B"]]),
  fullAllocation: { A: 100, B: 100 },
  gate: 3,
  minDiscordant: 20,
  compute,
  h1: ["ceiling", "top"] as const,
});

test("pilot report: per-model rows, spend share, audit, H1 verdict, cascade check", () => {
  const md = pilotReport(inputs(pilot()));
  assert.match(md, /\| Opus 5\.5 \| 6 \|.*\| 2\/2 \(100\.0%\) \|.*\| 2 \| 0 \| 0 \|/, "refusals counted and excluded");
  assert.match(md, /Fable 5\.1's share: 54%/);
  assert.match(md, /2 run\(s\) reported no cost/);
  assert.match(md, /fallback-model` set: \*\*0\*\*/);
  assert.match(md, /Cost source: claude_code 28, none 2/);
  assert.match(md, /\*\*inconclusive — 0 discordant tasks\*\*/, "top has only 2 valid attempts, so no paired tasks");
  assert.match(md, /No label changed/);
  assert.match(md, /majority pass 2\/2 \(100\.0%\), vs 2\/2 \(100\.0%\)/, "control arm");
});

test("project: cascade drops runs where the cheap tier already passes 3/3, and prices Modal from wall time", () => {
  const easy = ORDER.flatMap((tier) => [1, 2, 3].map((i) => run("e", tier, i, "pass", 1)));
  const s = new Map([["e", "A"]]);
  const grid = project(easy, easy, s, { A: 10 }, compute);
  const casc = project(easy, cascadePrune(easy, ORDER, 3), s, { A: 10 }, compute);
  assert.equal(grid.runs, 120);
  assert.equal(casc.runs, 30);
  assert.equal(grid.api, 120);
  assert.equal(casc.api, 30);
  assert.ok(Math.abs(casc.modal - 30 * modalUsd(600, compute, 0)) < 1e-9);
  assert.ok(Math.abs(modalUsd(600, compute, 0) - 0.06) < 1e-12, "600 s x 1 core x $0.0001");
});

test("projection table lists full grid, cascade and cascade at half size", () => {
  const md = pilotReport(inputs(pilot()));
  assert.match(md, /\| Full grid, 200 tasks \| 2400 \|/);
  assert.match(md, /\| Cascade, 200 tasks \|/);
  assert.match(md, /\| Cascade, 100 tasks \|/);
});
