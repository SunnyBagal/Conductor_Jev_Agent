import { test } from "node:test";
import assert from "node:assert/strict";
import { beatsJev, headline } from "../src/report.ts";
import { computeMetrics, type Metrics, type Pair } from "../src/metrics.ts";
import type { EvalResult } from "../src/eval.ts";
import type { Tier } from "../src/data.ts";

const m = (pairs: [Tier, Tier][]): Metrics =>
  computeMetrics(pairs.map(([routed, label], i): Pair => ({ id: String(i), routed, label, sure: "yes", confidence: null })), null);

const ev = (jev: Metrics, others: Record<string, Metrics>): EvalResult => ({
  set: "test",
  ids: jev.n,
  mock: false,
  config_hash: "x",
  test_runs: 1,
  results: [jev, ...Object.values(others)].map((metrics, i) => ({
    router: i === 0 ? "jev" : Object.keys(others)[i - 1]!,
    metrics,
    missing: 0,
    models: [],
    pairs: [],
    routes: [],
  })),
});

test("a baseline with equal under-routing and equal spend counts as matching Jev", () => {
  const same = m([["cheap", "cheap"], ["frontier", "frontier"]]);
  assert.ok(beatsJev(same, same));
});

test("a baseline that under-routes more does not beat Jev even if cheaper", () => {
  assert.ok(!beatsJev(m([["standard", "standard"]]), m([["cheap", "standard"]])));
});

test("headline names a baseline that matches or beats Jev, with counts", () => {
  const jev = m([["cheap", "frontier"], ["frontier", "frontier"]]);
  const kw = m([["frontier", "frontier"], ["cheap", "cheap"]]);
  const h = headline(ev(jev, { keywords: kw, always_frontier: m([["frontier", "frontier"], ["frontier", "frontier"]]) }));
  assert.match(h, /1\/2 \(50\.0%\)/);
  assert.match(h, /`keywords` matches or beats Jev/);
  assert.match(h, /held-out TEST set/);
});

test("headline says so when no baseline matches", () => {
  const jev = m([["cheap", "cheap"]]);
  assert.match(headline(ev(jev, { always_frontier: m([["frontier", "cheap"]]) })), /No baseline matched/);
});
