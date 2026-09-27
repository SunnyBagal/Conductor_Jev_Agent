import { test } from "node:test";
import assert from "node:assert/strict";
import { attemptError, compare, labelOf, registrationError, type DAttempt, type DTask } from "../src/trackd.ts";

const task = (id: string): DTask => ({ task_id: id, repo: "r", prompt: "p", prompt_sha256: "h", test_cmd: "npm test", registered_at: "t" });
const att = (task_id: string, model: DAttempt["model"], success: boolean): DAttempt => ({ task_id, model, tests_pass: success, would_merge: success, success, review_minutes: 5, notes: "", logged_at: "t" });

test("logging rules: registered, Jev first, cascade order, stop at success, no repeats", () => {
  const tasks = [task("d1")];
  assert.match(attemptError(tasks, [], true, { task_id: "zz", model: "haiku" })!, /not registered/);
  assert.match(attemptError(tasks, [], false, { task_id: "d1", model: "haiku" })!, /Jev predictions/);
  assert.match(attemptError(tasks, [], true, { task_id: "d1", model: "sonnet" })!, /next for d1 is haiku/);
  assert.equal(attemptError(tasks, [], true, { task_id: "d1", model: "haiku" }), null);
  assert.equal(attemptError(tasks, [att("d1", "haiku", false)], true, { task_id: "d1", model: "sonnet" }), null);
  assert.match(attemptError(tasks, [att("d1", "haiku", false)], true, { task_id: "d1", model: "haiku" })!, /already attempted/);
  assert.match(attemptError(tasks, [att("d1", "haiku", true)], true, { task_id: "d1", model: "sonnet" })!, /already succeeded/);
});

test("registration closes once attempts start", () => {
  assert.equal(registrationError([]), null);
  assert.match(registrationError([att("d1", "haiku", false)])!, /closed/);
});

test("success needs tests AND would-merge; label is the cheapest success", () => {
  assert.equal(labelOf([att("a", "haiku", true)], "a"), "cheap");
  assert.equal(labelOf([att("a", "haiku", false), att("a", "sonnet", true)], "a"), "standard");
  assert.equal(labelOf([att("a", "haiku", false), att("a", "sonnet", false), att("a", "opus", false)], "a"), "unsolved");
  assert.equal(labelOf([att("a", "haiku", false)], "a"), "incomplete");
});

test("compare counts under/over and marks unobserved first tries", () => {
  const attempts = [att("a", "haiku", true), att("b", "haiku", false), att("b", "sonnet", true)];
  const labels = new Map([["a", labelOf(attempts, "a")], ["b", labelOf(attempts, "b")], ["c", "incomplete" as const]]);
  const r = compare(labels, () => "cheap", attempts);
  assert.equal(r.n, 2, "incomplete tasks excluded");
  assert.deepEqual([r.exact.k, r.under.k, r.over.k], [1, 1, 0]);
  assert.deepEqual(r.firstTry, { yes: 1, no: 1, unobserved: 0 });
  const f = compare(labels, () => "frontier", attempts);
  assert.deepEqual(f.firstTry, { yes: 0, no: 0, unobserved: 2 }, "Opus never ran on these, so its success is not assumed");
});
