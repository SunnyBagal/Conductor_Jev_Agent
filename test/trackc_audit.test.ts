import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRewrite } from "../src/trackc/audit.ts";

test("flags effort hints and solution leaks, not expected behaviour or complex numbers", () => {
  assert.deepEqual(auditRewrite("a", "srepr ignores dicts. Should be a quick fix.").map((f) => f.rule), ["effort/severity hint"]);
  assert.deepEqual(auditRewrite("b", "BytesWarning in setuponly.py. Should use saferepr instead.").map((f) => f.rule), ["possible solution"]);
  assert.deepEqual(auditRewrite("c", "check the `if fields` condition in model_to_dict").map((f) => f.rule), ["possible solution"]);
  assert.deepEqual(auditRewrite("d", "coth.eval has a typo, probably should be cothm").map((f) => f.rule), ["possible solution"]);
  assert.deepEqual(auditRewrite("e", "is_zero is wrong for complex Add expressions, should return None"), []);
  assert.deepEqual(auditRewrite("f", "parse_expr ignores evaluate=False, should return Lt(1, 2) instead of True"), []);
  assert.deepEqual(auditRewrite("g", "One. Two. Three. Four.").map((f) => f.rule), ["too long"]);
});
