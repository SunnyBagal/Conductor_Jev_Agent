# Jev Router Eval: plan and report, in brief

**The question:** can Jev read a coding-agent prompt and pick the right model tier (cheap / standard / frontier)? The key error is **under-routing**: sending a task to a model that's too weak for it.

**How it works:** Jev answers a fixed set of simple questions about each prompt in one call, and plain code (`src/policy.ts`) turns the answers into a tier. Risky or destructive work goes to frontier, and uncertainty only ever rounds *up*.

## Status (2026-09-28)
| Track | What | Status |
|---|---|---|
| A | Your own hand-labelled prompts | ⏳ **Waiting for your labels** (`data/labels.csv`, guide in `docs/LABELING.md`) |
| B | SWE-bench: which real model solved each task | ✅ Done. Results below are **exploratory** |
| C | Casual prompts + agent runs on current models | 🧊 **Frozen** (tag `trackc-frozen`); see the write-up |
| D | Real tasks on your repos, run by you in Claude Code | ⏳ **Protocol pre-registered**, tools ready, no runs yet |

**Budget:** the Anthropic API budget is **$0**, blocked in code. Spent so far: **$7.82 Anthropic + $0.05 Jev + $0 Modal.** Any Jev run over 100 new calls shows an estimate and needs `--approve-jev`.

## Track B: SWE-bench (exploratory)
Ground truth is which model's recorded run actually solved each SWE-bench Verified task. Thresholds were tuned on one half and scored on the other. Full detail: [`reports/trackb.md`](reports/trackb.md).

**Claude 4.5 ladder** (one clean scaffold, measured cost per task, 190 test tasks):
| Router | Under-routed | Measured $/task |
|---|---|---|
| Always standard (Sonnet 4.5) | 7/190 | $0.635 |
| Jev (credible-set rule) | 1/190 | $0.604 |
| Always frontier (Opus 4.5) | 0/190 | $0.640 |
| Cascade, upper bound | 0/190 | $0.446 solved-only; **1.35× always-standard across all 500** |

**Claude 4 ladder** (not a clean scaffold, 199 test tasks): always-standard 9/199 under-routed at 1.00× cost; Jev 12/199 at 2.13×.

**Caveats that still apply:**
- **Test half viewed more than once:** it was looked at repeatedly (logged in `reports/trackb_test_runs.log`), so none of this is confirmatory.
- **Ladder 1's cheap run isn't comparable:** it came from an older, non-pass@1 run.
- **Sonnet and Opus score almost the same on this benchmark,** which punishes any router that routes up.
- **The cascade is an upper bound:** it uses SWE-bench's hidden tests as a perfect failure signal.
- **Issues aren't agent prompts:** SWE-bench issues are long bug reports, not the short prompts people give agents.

**Takeaways:**
- Per-token price isn't per-task cost: Opus 4.5 costs only 1.15× Sonnet 4.5 per task.
- Jev's edge over always-standard is within the noise.

## Track C: frozen
Rewriting SWE-bench issues into casual prompts kept leaking the fix, even with a two-stage pipeline and an LLM judge validated on 40 hand-judged cases (8/8 fix leaks caught). The pre-registered stopping rule triggered, there's no budget for agent runs, and the resulting exclusions would be biased. **Write-up: [`docs/trackc_writeup.md`](docs/trackc_writeup.md).**

## Track A: next steps (Jev only)
1. Fill `data/labels.csv` (`id,prompt,label,sure`) using `docs/LABELING.md`.
2. `npm run cli -- import-labels`, then `split`, then **commit the split**. `route` refuses to run until it's committed.
3. `DECIDER=typesafe npm run cli -- route`, then `baselines`, `sweep`, `eval`, `report`. At the very end, once: `eval --final`.

## Track D: next steps (you run the agents)
Protocol: [`docs/trackd_protocol.md`](docs/trackd_protocol.md).
1. `trackd-add-task` for each of 10–15 real tasks (register **all** of them before any run).
2. `DECIDER=typesafe npm run cli -- trackd-jev`, then commit `data/trackd_jev.jsonl`.
3. Run the cascade yourself in Claude Code: Haiku, then Sonnet, then Opus. Log each attempt with `trackd-log`.
4. `trackd-report` produces a counts-only comparison with limitations.

## Things to know
- **OpenRouter:** Jev isn't on OpenRouter, so `TYPESAFE_BASE_URL` only helps with a host that serves TypeSafe's own API.
- **Risk questions:** "risky area" is 5 atomic questions and "destructive" is 3, combined in code.
