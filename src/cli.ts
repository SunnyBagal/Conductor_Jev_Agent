#!/usr/bin/env -S npx tsx --env-file-if-exists=.env
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { filledCosts, loadCosts, loadSwebenchConfig, loadThresholds } from "./config.ts";
import { paths } from "./data.ts";

const HELP = `jev-router-eval: does TypeSafe's Jev route coding-agent prompts to the right model tier?

Usage: npm run cli -- <command> [options]

Commands
  split       stratified tune/test split -> <data-dir>/split.json (refuses to overwrite)
  route       run Jev over tasks -> runs/jev.jsonl
  baselines   length / keyword / constant baselines (+ --with-llm) -> runs/*.jsonl
  sweep       threshold sweep on the TUNE set -> runs/sweep.json
  eval        score all routers on the TUNE set (TEST set only with --final)
  report      write reports/report.md (+ sweep.svg)
  label       optional second labeler (Claude) -> llm_labels.jsonl, disagreements.jsonl
  swebench    Track B on SWE-bench Verified (fill config/swebench.json first)
  trackb      Track B deep-dive -> reports/trackb.md (after swebench; scores the frozen test half)
  all         split (if missing) -> route -> baselines -> sweep -> eval -> report

Options
  --data-dir DIR     dataset folder (default: data). Fixtures: data/fixtures
  --limit N          only the first N tasks
  --concurrency N    parallel API calls (default 8)
  --dry-run          print Jev requests, make no API calls
  --final            eval/report on the TEST set; logged to reports/test_runs.log
  --force            split: overwrite an existing split
  --extend           split: assign only new ids, keep existing assignments
  --with-llm         baselines: add the cheap Claude classifier

Environment
  DECIDER=mock|typesafe   where Jev answers come from (default: mock)
  MOCK_FALLBACK=hash      mock: invent deterministic answers for tasks missing from mock_answers.jsonl
  TYPESAFE_API_KEY        required for DECIDER=typesafe
  TYPESAFE_BASE_URL       point the TypeSafe SDK at another host
  TYPESAFE_MODEL          Jev model (default jev-1.13.0)
  ANTHROPIC_API_KEY       for --with-llm and label (or an \`ant auth login\` profile)
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "data-dir": { type: "string", default: "data" },
      limit: { type: "string" },
      concurrency: { type: "string", default: "8" },
      "dry-run": { type: "boolean", default: false },
      final: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      extend: { type: "boolean", default: false },
      "with-llm": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd) {
    console.log(HELP);
    return;
  }

  const int = (name: string, v: string | undefined) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer, got "${v}"`);
    return n;
  };
  const limit = int("limit", values.limit);
  const concurrency = int("concurrency", values.concurrency)!;
  const p = paths(values["data-dir"]);
  const th = loadThresholds();
  const costs = filledCosts(loadCosts());
  if (!costs && ["eval", "report", "all", "sweep"].includes(cmd))
    console.warn("note: config/costs.json has placeholders; spend is shown as mean tier rank until you fill it in.");

  const split = async (force: boolean, extend: boolean) =>
    (await import("./split.ts")).runSplit(p, { seed: th.split.seed, testFraction: th.split.test_fraction, force, extend });
  const route = async () => (await import("./route.ts")).runRoute(p, th.policy, { limit, concurrency, dryRun: values["dry-run"] });
  const baselines = async () =>
    (await import("./baselines.ts")).runBaselines(p, th, costs, { withLlm: values["with-llm"], concurrency, limit });
  const sweep = async () => (await import("./sweep.ts")).runSweep(p, th, costs);
  const evaluate = async () => (await import("./eval.ts")).runEval(p, th, costs, values.final);
  const report = async () => (await import("./report.ts")).runReport(p, costs, values.final);

  switch (cmd) {
    case "split":
      await split(values.force, values.extend);
      break;
    case "route":
      await route();
      break;
    case "baselines":
      await baselines();
      break;
    case "sweep":
      await sweep();
      break;
    case "eval":
      await evaluate();
      break;
    case "report":
      await report();
      break;
    case "label":
      await (await import("./label.ts")).runLabel(p, { concurrency, limit });
      break;
    case "swebench":
      await (await import("./swebench.ts")).runSwebench(p, loadSwebenchConfig(), th.policy, costs, { concurrency, limit });
      break;
    case "trackb":
      await (await import("./trackb.ts")).runTrackB(th, loadCosts(), loadSwebenchConfig());
      break;
    case "all":
      if (values["dry-run"]) {
        await route();
        break;
      }
      if (!existsSync(p.split)) await split(false, false);
      await route();
      if (process.exitCode) throw new Error("route had failures; stopping before eval.");
      await baselines();
      await sweep();
      await evaluate();
      await report();
      break;
    default:
      throw new Error(`Unknown command "${cmd}". Run with --help.`);
  }
}

main().catch((e: unknown) => {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
