import { test } from "node:test";
import assert from "node:assert/strict";
import { confusion, confusionMarkdown } from "../src/trackc/judge.ts";

test("confusion: counts, agreement, and the strict fix-leak requirement", () => {
  const c = confusion([
    { gold: "fix_leak", pred: "fix_leak" },
    { gold: "fix_leak", pred: "cause_hint" },
    { gold: "clean", pred: "clean" },
    { gold: "cause_hint", pred: "clean" },
  ]);
  assert.equal(c.fixLeaks, 2);
  assert.equal(c.fixCaught, 1);
  assert.equal(c.passes, false, "flagging a fix leak as a different label does not count");
  assert.equal(c.matrix.fix_leak.cause_hint, 1);
  assert.equal(c.agreement, 2);
  assert.match(confusionMarkdown(c), /\| \*\*fix_leak\*\* \| 0 \| \*\*1\*\* \| 1 \| 0 \| 0 \|/);
  assert.equal(confusion([{ gold: "fix_leak", pred: "fix_leak" }]).passes, true);
});
