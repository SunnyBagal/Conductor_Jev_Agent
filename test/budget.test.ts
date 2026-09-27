import { test } from "node:test";
import assert from "node:assert/strict";
import { assertApproved, assertCanSpend, budgetedClient, BudgetError, usd, type Budget } from "../src/budget.ts";

const b: Budget = { cap_usd: 1.5, approval_threshold_usd: 0.25, batch_discount: 0.5, prices: { "claude-haiku-4-5": { input: 1, output: 5 } } };

test("usd prices by model prefix and applies the batch discount", () => {
  assert.equal(usd(b, "claude-haiku-4-5-20251001", 1_000_000, 0, false), 1);
  assert.equal(usd(b, "claude-haiku-4-5-20251001", 1_000_000, 0, true), 0.5);
  assert.throws(() => usd(b, "claude-opus-5-5", 1, 1, false), /no price/);
});

test("approval required above the threshold", () => {
  assert.doesNotThrow(() => assertApproved(b, 0.2, undefined, "x"));
  assert.throws(() => assertApproved(b, 0.3, undefined, "x"), BudgetError);
  assert.throws(() => assertApproved(b, 0.3, 0.29, "x"), BudgetError);
  assert.doesNotThrow(() => assertApproved(b, 0.3, 0.3, "x"));
});

test("cap check refuses spend beyond the cap", () => {
  assert.throws(() => assertCanSpend({ ...b, cap_usd: 0 }, 0.0001, "x"), /Stopping/);
});

test("budgetedClient blocks unmetered beta endpoints and refuses calls over the cap", async () => {
  process.env.ANTHROPIC_API_KEY ??= "test-key-not-used";
  const c = budgetedClient("t", { ...b, cap_usd: 0 });
  assert.throws(() => c.beta, BudgetError);
  await assert.rejects(c.messages.create({ model: "claude-haiku-4-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }), BudgetError);
});
