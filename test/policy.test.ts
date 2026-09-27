import { test } from "node:test";
import assert from "node:assert/strict";
import { credibleSet, decide, JevAnswersSchema, type JevAnswers } from "../src/policy.ts";
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
  mass_coverage: 0,
};

interface Fx {
  type?: TaskType;
  typeConf?: number;
  scope?: number;
  scopeConf?: number;
  nouls?: Partial<Record<(typeof NOUL_IDS)[number], number>>;
  typeProbs?: Record<string, number>;
  scopeProbs?: Record<string, number>;
}

/** Confident, low-risk answers by default; override what a test is about. */
function fx({ type = "feature_clear_spec", typeConf = 0.9, scope = 1, scopeConf = 0.9, nouls = {}, typeProbs, scopeProbs }: Fx = {}): JevAnswers {
  const raw = {
    task_type: { type: "choice", choice: type, confidence: typeConf, probabilities: typeProbs ?? { [type]: 1 } },
    scope: { type: "score", score: scope, confidence: scopeConf, probabilities: scopeProbs ?? { [String(Math.round(scope))]: 1 } },
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

// --- credible-set rule (mass_coverage > 0) ---------------------------------

const M = { ...T, mass_coverage: 0.8 };

test("credibleSet takes the fewest top options reaching the coverage, always including the choice", () => {
  assert.deepEqual(credibleSet({ a: 0.6, b: 0.3, c: 0.1 }, 0.8, "a"), ["a", "b"]);
  assert.deepEqual(credibleSet({ a: 0.95, b: 0.05 }, 0.8, "a"), ["a"]);
  assert.deepEqual(credibleSet({ a: 0.3, b: 0.14, c: 0.14, d: 0.14, e: 0.14, f: 0.14 }, 0.8, "a").length, 5);
  assert.deepEqual(credibleSet({ a: 0.5, b: 0.5 }, 0.8, "b"), ["b", "a"]);
});

test("mass rule: a split between same-tier options costs nothing (confidence rule rounds up)", () => {
  const a = fx({ type: "feature_clear_spec", typeConf: 0.2, typeProbs: { feature_clear_spec: 0.55, multi_file_refactor: 0.45 } });
  assert.equal(decide(a, T).tier, "frontier", "confidence rule: standard + round up");
  assert.equal(decide(a, M).tier, "standard", "both plausible types are standard");
});

test("mass rule: routes to the highest plausible tier", () => {
  const a = fx({ type: "trivial_edit", scope: 0, typeConf: 0.3, typeProbs: { trivial_edit: 0.6, investigate_unknown_cause: 0.35, other: 0.05 } });
  assert.equal(decide(a, M).tier, "frontier");
  assert.match(decide(a, M).reason, /plausible \{trivial_edit, investigate_unknown_cause\}/);
});

test("mass rule: a thin spread pulls in many options and rounds up", () => {
  const a = fx({
    type: "trivial_edit",
    scope: 0,
    typeConf: 0.1,
    typeProbs: { trivial_edit: 0.3, localized_bug_fix: 0.14, feature_clear_spec: 0.14, multi_file_refactor: 0.14, architecture_design: 0.14, other: 0.14 },
  });
  assert.equal(decide(a, M).tier, "frontier");
});

test("mass rule: never below Jev's top choice, even when confident and cheap", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, typeConf: 0.99, typeProbs: { trivial_edit: 0.97, other: 0.03 } }), M).tier, "cheap");
});

test("mass rule: a plausible wide scope level moves up one", () => {
  const a = fx({ type: "feature_clear_spec", scope: 1.4, scopeProbs: { "1": 0.6, "3": 0.4 } });
  assert.equal(decide(a, T).tier, "standard");
  assert.equal(decide(a, M).tier, "frontier");
});

test("mass rule: tiny localized fix goes cheap only when it is the sole plausible type", () => {
  const sole = fx({ type: "localized_bug_fix", scope: 0.2, scopeProbs: { "0": 0.9, "1": 0.1 }, typeProbs: { localized_bug_fix: 0.92, trivial_edit: 0.08 } });
  assert.equal(decide(sole, M).tier, "cheap");
  const split = fx({ type: "localized_bug_fix", scope: 0.2, scopeProbs: { "0": 0.9, "1": 0.1 }, typeProbs: { localized_bug_fix: 0.6, trivial_edit: 0.4 } });
  assert.equal(decide(split, M).tier, "standard");
});

test("mass rule still respects the risk gate and floors", () => {
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { risky_payments: 0.9 } }), M).tier, "frontier");
  assert.equal(decide(fx({ type: "trivial_edit", scope: 0, nouls: { needs_exploration: 0.9 } }), M).tier, "standard");
});
