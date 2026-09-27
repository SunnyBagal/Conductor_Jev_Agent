import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { namesOutsideFacts, rewriteFromFacts, styleLine, type Facts } from "../src/trackc/stages.ts";

const facts: Facts = {
  user_action: "call clone() on an estimator whose param is a class",
  observed_behavior: "TypeError: get_params() missing 1 required positional argument: 'self'",
  expected_behavior: "no error",
  reproduction: "clone(StandardScaler(with_mean=StandardScaler))",
  symptom_locations: ["sklearn/base.py", "clone"],
};

test("stage 2 receives only the facts JSON, never issue text", async () => {
  const calls: { system: string; messages: { content: string }[] }[] = [];
  const client = {
    messages: {
      create: async (b: (typeof calls)[number]) => {
        calls.push(b);
        return { model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "clone crashes on class params" }], usage: { input_tokens: 1, output_tokens: 1 } };
      },
    },
  } as unknown as Anthropic;
  const r = await rewriteFromFacts(client, facts, { model: "m", temperature: 0, maxTokens: 50, instruction: "rules" });
  assert.equal(r.text, "clone crashes on class params");
  assert.equal(calls[0]!.messages.length, 1);
  assert.equal(calls[0]!.messages[0]!.content, `<bug_facts>\n${JSON.stringify(facts, null, 2)}\n</bug_facts>`);
});

test("styleLine fills allowed names for file_mention", () => {
  assert.equal(styleLine("use only: {symptom_locations}.", facts), "use only: `sklearn/base.py`, `clone`.");
  assert.equal(styleLine("use only: {symptom_locations}.", { ...facts, symptom_locations: [] }), "use only: (none).");
  assert.equal(styleLine("terse.", facts), "terse.");
});

test("namesOutsideFacts flags identifiers and files not in the facts", () => {
  assert.deepEqual(namesOutsideFacts("`clone` in sklearn/base.py fails with TypeError", facts), []);
  assert.deepEqual(namesOutsideFacts("check `_get_params_safe` in utils/validation.py", facts), ["_get_params_safe", "utils/validation.py"]);
});
