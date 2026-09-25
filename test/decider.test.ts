import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, hashAnswers, makeDecider, MockDecider, TypeSafeDecider } from "../src/decider.ts";
import { runPool } from "../src/pool.ts";

const task = (id: string, prompt = "fix typo") => ({ id, prompt, source: "manual" as const });

test("hashAnswers is deterministic and schema-valid", () => {
  assert.deepEqual(hashAnswers("abc"), hashAnswers("abc"));
  assert.notDeepEqual(hashAnswers("abc"), hashAnswers("abd"));
});

test("MockDecider fails loudly on missing ids unless hash fallback is on", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "jre-")), "mock.jsonl");
  writeFileSync(f, JSON.stringify({ id: "a", answers: hashAnswers("x") }) + "\n");
  const strict = new MockDecider(f);
  assert.equal((await strict.decide(task("a"))).model, "mock");
  await assert.rejects(strict.decide(task("b")), /no mock answers for task "b"/);
  assert.equal((await new MockDecider(f, true).decide(task("b"))).model, "mock-hash");
});

test("TypeSafeDecider fails loudly without TYPESAFE_API_KEY", () => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    assert.throws(() => new TypeSafeDecider(mkdtempSync(join(tmpdir(), "jre-"))), /TYPESAFE_API_KEY is not set/);
  } finally {
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
  }
});

test("makeDecider rejects unknown DECIDER values", () => {
  const saved = process.env.DECIDER;
  process.env.DECIDER = "gpt";
  try {
    assert.throws(() => makeDecider("nope.jsonl"), /DECIDER must be/);
  } finally {
    if (saved === undefined) delete process.env.DECIDER;
    else process.env.DECIDER = saved;
  }
});

test("cacheKey depends on prompt", () => {
  assert.equal(cacheKey("a"), cacheKey("a"));
  assert.notEqual(cacheKey("a"), cacheKey("b"));
});

test("runPool bounds concurrency, keeps order, and isolates failures", async () => {
  let inFlight = 0;
  let peak = 0;
  const res = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (n === 3) throw new Error("boom");
    return n * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    res.map((r) => (r.status === "fulfilled" ? r.value : "err")),
    [10, 20, "err", 40, 50, 60],
  );
});
