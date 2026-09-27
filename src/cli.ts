#!/usr/bin/env -S npx tsx --env-file-if-exists=.env
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { filledCosts, loadCosts, loadSwebenchConfig, loadThresholds } from "./config.ts";
import { paths } from "./data.ts";

const HELP = `jev-router-eval: does TypeSafe's Jev route coding-agent prompts to the right model tier?

Usage: npm run cli -- <command> [options]

Commands
  import-labels   build data/tasks.jsonl from data/labels.csv (Track A)
  split       stratified tune/test split -> <data-dir>/split.json (refuses to overwrite)
  route       run Jev over tasks -> runs/jev.jsonl
  baselines   length / keyword / constant baselines (+ --with-llm) -> runs/*.jsonl
  sweep       threshold sweep on the TUNE set -> runs/sweep.json
  eval        score all routers on the TUNE set (TEST set only with --final)
  report      write reports/report.md (+ sweep.svg)
  label       optional second labeler (Claude) -> llm_labels.jsonl, disagreements.jsonl
  swebench    Track B on SWE-bench Verified (fill config/swebench.json first)
  trackb      Track B deep-dive -> reports/trackb.md (after swebench; scores the frozen test half)
  trackc-select   Track C stratified task sample -> data/trackc_tasks.jsonl (refuses to overwrite)
  trackc-variants assign style variants per task (fixed seed) -> data/trackc_variants.jsonl
  trackc-rewrite  casual prompt per task (issue text only) -> data/trackc_prompts.jsonl (resumable)
  trackc-judge-validate  validate the r3 judge on frozen hand labels (must catch every fix leak)
  trackc-r3       two-stage rewrite (facts -> casual) for all tasks -> data/trackc_prompts.jsonl
  trackc-judge    judge every r3 rewrite and Stage 1 facts JSON
  trackc-review-r3  r3 review page + pre-registered stopping rule (no API calls)
  trackc-review   15 random rewrites next to originals -> docs/trackc_rewrite_review.md
  trackd-add-task  register a real task: --id --repo --test-cmd --prompt [--base-commit]
  trackd-jev       Jev prediction per Track D task (once, before any attempt)
  trackd-log       log one attempt: --id --model haiku|sonnet|opus --tests-pass yes|no --would-merge yes|no --review-min N [--notes] [--cc-version]
  trackd-report    reports/trackd.md (counts only)
  all         split (if missing) -> route -> baselines -> sweep -> eval -> report

Options
  --data-dir DIR     dataset folder (default: data). Fixtures: data/fixtures
  --limit N          only the first N tasks
  --concurrency N    parallel API calls (default 8)
  --dry-run          print Jev requests, make no API calls
  --final            eval/report on the TEST set; logged to reports/test_runs.log
  --force            split: overwrite an existing split
  --extend           split: assign only new ids, keep existing assignments
  --with-llm         baselines: add the cheap Claude classifier (blocked: Anthropic budget is $0)
  --approve-jev      allow a real Jev run that needs more than 100 new calls

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
      "approve-jev": { type: "boolean", default: false },
      id: { type: "string" },
      repo: { type: "string" },
      prompt: { type: "string" },
      "test-cmd": { type: "string" },
      "base-commit": { type: "string" },
      model: { type: "string" },
      "tests-pass": { type: "string" },
      "would-merge": { type: "string" },
      "review-min": { type: "string" },
      notes: { type: "string" },
      "cc-version": { type: "string" },
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
  const route = async () => (await import("./route.ts")).runRoute(p, th.policy, { limit, concurrency, dryRun: values["dry-run"], approveJev: values["approve-jev"] });
  const baselines = async () =>
    (await import("./baselines.ts")).runBaselines(p, th, costs, { withLlm: values["with-llm"], concurrency, limit });
  const sweep = async () => (await import("./sweep.ts")).runSweep(p, th, costs);
  const evaluate = async () => (await import("./eval.ts")).runEval(p, th, costs, values.final);
  const report = async () => (await import("./report.ts")).runReport(p, costs, values.final);

  switch (cmd) {
    case "import-labels":
      (await import("./tracka.ts")).importLabels(p);
      break;
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
      await (await import("./swebench.ts")).runSwebench(p, loadSwebenchConfig(), th.policy, costs, { concurrency, limit, approveJev: values["approve-jev"] });
      break;
    case "trackb":
      await (await import("./trackb.ts")).runTrackB(th, loadCosts(), loadSwebenchConfig());
      break;
    case "trackc-select":
      await (await import("./trackc/index.ts")).runSelect(values.force);
      break;
    case "trackc-judge-validate":
      await (await import("./trackc/r3.ts")).runJudgeValidate({ concurrency });
      break;
    case "trackc-r3":
      await (await import("./trackc/r3.ts")).runR3({ concurrency, limit });
      break;
    case "trackc-review-r3":
      await (await import("./trackc/r3.ts")).runReviewR3();
      break;
    case "trackc-judge":
      await (await import("./trackc/r3.ts")).runJudgeAll({ concurrency });
      break;
    case "trackc-variants":
      (await import("./trackc/index.ts")).runVariants(values.force);
      break;
    case "trackc-rewrite":
      await (await import("./trackc/index.ts")).runRewriteCmd({ concurrency, limit });
      break;
    case "trackc-review":
      await (await import("./trackc/index.ts")).runReview();
      break;
    case "trackd-add-task":
      (await import("./trackd.ts")).addTask({ id: values.id, repo: values.repo, prompt: values.prompt, testCmd: values["test-cmd"], baseCommit: values["base-commit"] });
      break;
    case "trackd-jev":
      await (await import("./trackd.ts")).runTrackDJev(th.policy, { approveJev: values["approve-jev"] });
      break;
    case "trackd-log":
      (await import("./trackd.ts")).logAttempt({ id: values.id, model: values.model, testsPass: values["tests-pass"], wouldMerge: values["would-merge"], reviewMin: values["review-min"], notes: values.notes, ccVersion: values["cc-version"] });
      break;
    case "trackd-report":
      (await import("./trackd.ts")).trackDReport();
      break;
    case "all":
      if (values["dry-run"]) {
        await route();
        break;
      }
      if (!existsSync(p.split)) {
        await split(false, false);
        if (p.dataDir === "data") {
          console.log(`\nSplit written. Commit it before routing:\n  git add ${p.split} ${p.labels} ${p.tasks} && git commit -m "Track A split"\nthen run \`all\` again.`);
          break;
        }
      }
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
