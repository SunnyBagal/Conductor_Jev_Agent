import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, JevAnswersSchema, type JevAnswers } from "../src/policy.ts";
import type { PolicyThresholds } from "../src/config.ts";
import { NOUL_IDS, type TaskType } from "../src/questions.ts";

const T: PolicyThresholds = {
  risky: 0.5,
  destructive: 0.5,
  underspecified: 0.6,
  needs_exploration: 0.6,
  scope_up: 2.5,
  scope_down: 0.5,
  task_type_conf: 0.5,
  scope_conf: 0.4,
};

interface Fx {
  type?: TaskType;
  typeConf?: number;
  scope?: number;
  scopeConf?: number;
  nouls?: Partial<Record<(typeof NOUL_IDS)[number], number>>;
}

/** Confident, low-risk answers by default; override what a test is about. */
function fx({ type = "feature_clear_spec", typeConf = 0.9, scope = 1, scopeConf = 0.9, nouls = {} }: Fx = {}): JevAnswers {
  const raw = {
    task_type: { type: "choice", choice: type, confidence: typeConf, probabilities: { [type]: 1 } },
    scope: { type: "score", score: scope, confidence: scopeConf, probabilities: { "1": 1 } },
    ...Object.fromEntries(NOUL_IDS.map((id) => [id, { type: "noul", noul: nouls[id] ?? 0.05 }])),
  };
  return JevAnswersSchema.parse(raw);
}

test("base tier comes from task_type", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0 }), T).tier, "cheap");
  assert.equal(decide(fx({ type: "localized_bug_fix", scope: 1 }), T).tier, "standard");
  assert.equal(decide(fx({ type: "feature_clear_spec" }), T).tier, "standard");
  assert.equal(decide(fx({ type: "multi_file_refactor", scope: 2 }), T).tier, "standard");
  assert.equal(decide(fx({ type: "architecture_design" }), T).tier, "frontier");
  assert.equal(decide(fx({ type: "investigate_unknown_cause" }), T).tier, "frontier");
  assert.equal(decide(fx({ type: "other" }), T).tier, "standard");
});

test("any single risky-area Noul at threshold forces frontier", () => {
  for (const id of ["risky_auth", "risky_payments", "risky_security", "risky_db_migration", "risky_infra"] as const) {
    const d = decide(fx({ type: "trivial_edit", scope: 0, nouls: { [id]: 0.5 } }), T);
    assert.equal(d.tier, "frontier", id);
    assert.match(d.reason, new RegExp(id));
  }
});

test("any single destructive Noul at threshold forces frontier", () => {
  for (const id of ["destroys_data", "changes_schema", "rewrites_git_history"] as const) {
    assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { [id]: 0.9 } }), T).tier, "frontier", id);
  }
});

test("risk just below threshold does not force frontier", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { risky_auth: 0.49, destroys_data: 0.49 } }), T).tier, "cheap");
});

test("risk gate wins even when everything else says cheap and confident", () => {
  const d = decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.99, scopeConf: 0.99, nouls: { risky_infra: 0.8 } }), T);
  assert.equal(d.tier, "frontier");
  assert.doesNotMatch(d.reason, /task_type=/, "short-circuits before base tier");
});

test("wide scope moves up one tier, capped at frontier", () => {
  assert.equal(decide(fx({ type: "feature_clear_spec", scope: 2.5 }), T).tier, "frontier");
  assert.equal(decide(fx({ type: "trivial_edit", scope: 3 }), T).tier, "standard");
  assert.equal(decide(fx({ type: "architecture_design", scope: 3 }), T).tier, "frontier");
});

test("tiny confident localized fix goes cheap", () => {
  const d = decide(fx({ type: "localized_bug_fix", scope: 0.5 }), T);
  assert.equal(d.tier, "cheap");
  assert.match(d.reason, /confident localized fix/);
});

test("tiny localized fix does NOT go cheap when confidence is low (never round down)", () => {
  assert.equal(decide(fx({ type: "localized_bug_fix", scope: 0.2, typeConf: 0.3 }), T).tier, "frontier");
  assert.equal(decide(fx({ type: "localized_bug_fix", scope: 0.2, scopeConf: 0.3 }), T).tier, "frontier");
});

test("scope_down only applies to localized_bug_fix", () => {
  assert.equal(decide(fx({ type: "feature_clear_spec", scope: 0 }), T).tier, "standard");
});

test("underspecified / needs_exploration are floors at standard, not bumps", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { underspecified: 0.6 } }), T).tier, "standard");
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { needs_exploration: 0.9 } }), T).tier, "standard");
  assert.equal(decide(fx({ type: "feature_clear_spec", nouls: { underspecified: 0.9, needs_exploration: 0.9 } }), T).tier, "standard");
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { underspecified: 0.59 } }), T).tier, "cheap");
});

test("low task_type confidence rounds up one tier", () => {
  const d = decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.49 }), T);
  assert.equal(d.tier, "standard");
  assert.match(d.reason, /low confidence \(task_type 0\.49 < 0\.50\)/);
});

test("low scope confidence rounds up one tier", () => {
  assert.equal(decide(fx({ type: "feature_clear_spec", scopeConf: 0.39 }), T).tier, "frontier");
});

test("confidence exactly at the gate is NOT low", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.5, scopeConf: 0.4 }), T).tier, "cheap");
});

test("both confidences low still rounds up only once", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.1, scopeConf: 0.1 }), T).tier, "standard");
});

test("low confidence at frontier stays frontier and says so", () => {
  const d = decide(fx({ type: "architecture_design", typeConf: 0.2 }), T);
  assert.equal(d.tier, "frontier");
  assert.match(d.reason, /already frontier/);
});

test("low confidence is applied after floors", () => {
  // trivial -> floor to standard (underspecified) -> low conf -> frontier
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.2, nouls: { underspecified: 0.9 } }), T).tier, "frontier");
});

test("router confidence is min of task_type and scope confidence", () => {
  assert.equal(decide(fx({ typeConf: 0.8, scopeConf: 0.6 }), T).confidence, 0.6);
});

test("policy is pure: same input gives same output and input is not mutated", () => {
  const a = fx({ type: "localized_bug_fix", scope: 0.3 });
  const before = JSON.stringify(a);
  assert.deepEqual(decide(a, T), decide(a, T));
  assert.equal(JSON.stringify(a), before);
});

test("answer schema rejects missing questions and bad probabilities", () => {
  const good = fx();
  const { risky_auth: _omit, ...missing } = good;
  assert.throws(() => JevAnswersSchema.parse(missing));
  assert.throws(() => JevAnswersSchema.parse({ ...good, underspecified: { type: "noul", noul: 1.2 } }));
});
