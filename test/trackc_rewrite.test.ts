import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { instructionFor, rewriteIssue } from "../src/trackc/rewrite.ts";

function stub(reply: { text?: string; stop_reason?: string }) {
  const calls: unknown[] = [];
  const client = {
    messages: {
      create: async (body: unknown) => {
        calls.push(body);
        return {
          model: "stub-model",
          stop_reason: reply.stop_reason ?? "end_turn",
          content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const s = { model: "m", temperature: 0, maxTokens: 50, instruction: "Rewrite it." };

test("rewriteIssue sends only the issue text plus the fixed instruction", async () => {
  const { client, calls } = stub({ text: "  hey the export is broken in utils.py  " });
  const r = await rewriteIssue(client, "Export crashes on empty list", s);
  assert.equal(r.text, "hey the export is broken in utils.py");
  const body = calls[0] as { system: string; temperature: number; messages: { content: string }[] };
  assert.equal(body.system, "Rewrite it.");
  assert.equal(body.temperature, 0);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0]!.content, "<bug_report>\nExport crashes on empty list\n</bug_report>");
});

test("rewriteIssue rejects refusals, truncation and empty output", async () => {
  await assert.rejects(rewriteIssue(stub({ text: "x", stop_reason: "refusal" }).client, "i", s), /refused/);
  await assert.rejects(rewriteIssue(stub({ text: "x", stop_reason: "max_tokens" }).client, "i", s), /max_tokens/);
  await assert.rejects(rewriteIssue(stub({}).client, "i", s), /empty/);
});

test("the task's style line reaches the rewriter's system prompt", async () => {
  const { client, calls } = stub({ text: "ok" });
  const instruction = instructionFor("Base rules.", "Style for this message: terse.");
  await rewriteIssue(client, "issue", { ...s, instruction });
  assert.equal((calls[0] as { system: string }).system, "Base rules.\n\nStyle for this message: terse.");
  assert.equal(instructionFor("Base rules.", null), "Base rules.");
});
