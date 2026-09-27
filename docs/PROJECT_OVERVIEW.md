# Project overview (as of 2026-09-28)

## 1. Purpose
This repo tests whether **TypeSafe's Jev** can read a coding-agent prompt and send it to the **cheapest Claude model that can actually do the task** (cheap / standard / frontier). The costly mistake is *under-routing*: giving a task to a model that's too weak, which wastes an agent run and review time. The results are meant to back an honest pitch to **Conductor** about whether a Jev router is worth building.

**How routing works:** Jev answers a fixed set of simple questions about each prompt in one call (`src/questions.ts`), and plain code turns the answers into a tier (`src/policy.ts`). Risky or destructive work goes to frontier, and uncertainty only ever rounds *up*.

## 2. The tracks
| Track | Tests | Status | Main result / waiting on |
|---|---|---|---|
| **A** | Jev vs your own labels on your own prompts | ⏳ Waiting on you | Needs about 150 labelled prompts. Guide: [`LABELING.md`](LABELING.md) |
| **B** | Jev vs which model *actually* solved SWE-bench tasks | ✅ Done (exploratory) | Claude 4.5 ladder: Jev under-routed 1/190 at $0.604/task vs always-Sonnet's 7/190 at $0.635, **within the noise**. On the older Claude 4 ladder, always-Sonnet won. Opus 4.5 costs only 1.15× Sonnet 4.5 *per task*. See [`../reports/trackb.md`](../reports/trackb.md) |
| **C** | Casual rewrites of SWE-bench issues + agent runs on current models | 🧊 Frozen (tag `trackc-frozen`) | Rewrites kept leaking the fix (r3: 86/200 flagged). The stopping rule triggered and there's no budget for agent runs. See [`trackc_writeup.md`](trackc_writeup.md) |
| **D** | Real tasks from your repos, run by you in Claude Code | ⏳ Waiting on you | Protocol pre-registered: [`trackd_protocol.md`](trackd_protocol.md) |

## 3. Repo map
| Where | What |
|---|---|
| `src/questions.ts`, `src/policy.ts` | The Jev questions and the pure routing rule (**review these first**) |
| `src/decider.ts`, `src/route.ts` | Mock or real Jev, disk cache, Jev call guard, routing |
| `src/split.ts`, `baselines.ts`, `sweep.ts`, `eval.ts`, `metrics.ts`, `report.ts` | Track A pipeline: split → baselines → threshold sweep → eval → report |
| `src/swebench.ts`, `src/trackb.ts` | Track B: SWE-bench data loading and analysis |
| `src/trackc/` | Track C: task selection, rewrites, judge, outcomes, blind review (frozen) |
| `src/trackd.ts`, `src/tracka.ts` | Track D task registry and attempt log; Track A label import |
| `src/budget.ts` | The Anthropic spend guard |
| `config/` | Thresholds, costs/prices, models, SWE-bench ladders, Track C settings, **budget ($0)** |
| `data/` | Inputs and frozen data: labels, fixtures, Track C sample and rewrites, judge outputs, spend ledger |
| `reports/` | Generated results and the test-run logs |
| `docs/` | Plans and **pre-registrations** (`trackc_plan.md`, `trackd_protocol.md`), write-ups, guides |
| `runs/`, `.cache/` | Working outputs and cached API answers (git-ignored) |
| `test/` | 113 unit tests (`npm test`) |

## 4. Commands (in order, one example each)
- **Setup:** `npm install`. Keys go in the git-ignored `.env` (`TYPESAFE_API_KEY`).
- **Track A:**
  - `import-labels` → `split` → **commit** → `route` → `baselines` → `sweep` → `eval` → `report`
  - At the very end, once: `eval --final` and `report --final`.
  - Example: `DECIDER=typesafe npm run cli -- route`
- **Track B** (already cached, costs nothing to re-run): `npm run cli -- trackb` rebuilds `reports/trackb.md`.
- **Track C** (frozen): `npm run cli -- trackc-review-r3` rebuilds the review from saved data.
- **Track D:**
  - `trackd-add-task` (all tasks first) → `trackd-jev` → **commit** → run agents yourself → `trackd-log` per attempt → `trackd-report`
  - Example: `npm run cli -- trackd-log --id d01 --model haiku --tests-pass yes --would-merge no --review-min 6`
- **Everything else:** `npm run cli -- --help`.

## 5. Honesty safeguards (enforced in code)
Most of these exist to make it impossible to pick the "right" answer after seeing the results. The budget ones protect real money.
- **Splits:**
  - `split` won't overwrite an existing split, and it records a hash of `labels.csv`.
  - Track A `route` refuses to run until the split and labels are committed to git.
  - Track B's split is frozen in `reports/trackb_split.json`, and the tool aborts if it would change.
- **Test sets:**
  - Held-out numbers only come from `eval --final`, and every such run is logged with its git commit and a config hash.
  - Every time the Track B test half is scored, that's logged too, including 5 retroactive entries.
- **Pre-registration:** rules and hypotheses are committed *before* the data exists. The git timestamps are the proof.
- **Track C:**
  - Gold labels were frozen before the judge ran, and the judge had to pass a validation gate.
  - The code passes the rewriter only the issue text, and passes Stage 2 only the extracted facts.
- **Track D:**
  - Registration closes at the first attempt.
  - One lock hash covers each prompt and its check, so editing either is detected.
  - Jev must predict before any attempt, and the cascade order is enforced.
- **Mock results are flagged:** reports built on mock Jev answers carry a warning banner.
- **Budget:**
  - The Anthropic cap is $0: every call is blocked before it's sent, and unmetered SDK paths are blocked too.
  - Any Jev run needing more than 100 new calls stops with an estimate unless you pass `--approve-jev`.

## 6. Spend
**Anthropic: $7.821** (logged token usage at list prices; the invoice is the authority). Ledger: `data/spend_ledger.jsonl`.

| Run (all Track C) | Calls | Cost |
|---|---|---|
| r1 rewrites (Sonnet 4.6) | 200 | $0.576 |
| r2 rewrites (Sonnet 4.6) | 200 | $0.638 |
| r3 Stage 1 facts (Sonnet 4.6) | 200 | $1.209 |
| r3 Stage 2 rewrites (Sonnet 4.6) | 200 | $0.421 |
| Judge validation (Opus 5.5) | 40 | $0.432 |
| Judge on all r3 outputs (Opus 5.5), finished before any budget cap existed | 400 | $4.545 |

**Jev (TypeSafe): $0.049** for **508 calls**, all `jev-1.13.0`. That's 8 on the fixtures (the first real-Jev sanity run) and 500 on SWE-bench (Track B), about 2,300 input tokens each. Tracks C and D made no Jev calls. **Modal: $0** (never set up).

## 7. What's next (your manual work)
- **Track A:**
  1. Write about 150 prompts with labels into `data/labels.csv`, following `LABELING.md`.
  2. Run `import-labels` and `split`, then commit.
  3. Run `route` and the rest (about $0.015 of Jev).
- **Track D:**
  1. Register 10–15 real tasks, each with a test command or a locked manual check.
  2. Run `trackd-jev` and commit its output.
  3. Run Haiku, then Sonnet, then Opus yourself in Claude Code, each in a fresh branch.
  4. Log each attempt with `trackd-log`, then run `trackd-report`.
