# Jev Router Eval — plan and report, in brief

## The question
Can Jev read a coding-agent prompt and choose the right model tier (cheap, standard or frontier)?
The main mistake to measure is **under-routing**: sending a task to a model too weak to do it.

## How it works
1. **Ask Jev** the same set of simple questions about each prompt, in one API call: what kind of task it is, how much code changes, and whether it touches risky areas.
2. **Plain code picks the tier** from the answers (`src/policy.ts`), using these rules in order:
   - Anything risky or destructive goes to frontier.
   - If Jev isn't confident, the tier rounds **up** one step, never down.
3. **Compare Jev with simple baselines:** routing by prompt length, keyword rules, "always standard", "always frontier", and optionally a cheap Claude model.
4. **Score everything against your labels** from `data/labels.csv`.

## How we keep it honest
- **Separate tune and test sets.** Your labels are split once, with a fixed seed. Thresholds are tuned only on the tune set.
- **The test set runs only with `--final`.** Every final run is logged with its time, git commit and config hash, and the report shows how many times the test set has been run.
- **Counts next to every percentage,** e.g. `4/60 (6.7%)`.
- **Baselines are named in the headline** if they match or beat Jev.
- **Mock results are flagged.** A report built on mock answers carries a big warning.

## Status
| Part | State |
|---|---|
| Full pipeline | ✅ Runs end to end with `DECIDER=mock` on 8 fixtures |
| Tests | ✅ 69 passing (the policy is tested without any API) |
| Real Jev | ✅ Key loaded from `.env`; 508 real calls made (8 fixtures, 500 SWE-bench tasks) |
| Your dataset | ⏳ `data/tasks.jsonl` and `data/labels.csv` are empty |
| Costs | ✅ `config/costs.json` holds official per-token prices by model (source cited) |
| SWE-bench (Track B) | ✅ 500 tasks, two Claude ladders, full detail in [`reports/trackb.md`](reports/trackb.md). **Correction:** the Claude 4 ladder is *not* one clean scaffold (Haiku run is from 2024, not pass@1). The Claude 4.5 ladder is. |

## Findings with real Jev (SWE-bench, test half)
Ground truth is which model actually solved each task. Thresholds were tuned on ladder 1's tune half; the split is frozen. The test half has been viewed several times, so treat these as **exploratory**. Full detail: `npm run cli -- trackb` → [`reports/trackb.md`](reports/trackb.md).

**Ladder 2: Claude 4.5 (Haiku / Sonnet / Opus), one clean scaffold, measured cost per task**

| Router (190 tasks) | Under-routed ↓ | Measured $/task |
|---|---|---|
| Always standard (Sonnet 4.5) | 7/190 (3.7%) | $0.635 |
| **Jev, credible-set rule** | **1/190 (0.5%)** | **$0.604** |
| Always frontier (Opus 4.5) | 0/190 (0.0%) | $0.640 |
| Keywords | 8/190 (4.2%) | $0.536 |
| Cascade Haiku→Sonnet→Opus (upper bound) | 0/190 (0.0%) | $0.446 |

**Ladder 1: Claude 3.5 Haiku / 4 Sonnet / 4 Opus, estimated cost from per-token prices**

| Router (199 tasks) | Under-routed ↓ | Est. cost vs always-standard |
|---|---|---|
| **Always standard (Sonnet 4)** | **9/199 (4.5%)** | **1.00×** |
| Jev, credible-set rule | 12/199 (6.0%) | 2.13× |
| Risk gate only | 9/199 (4.5%) | 1.44× |
| Cascade (upper bound) | 0/199 (0.0%) | 0.80× |

- **The ladder decides the winner.** Opus 4 barely beats Sonnet 4 (366 vs 362 of 500 solved), so routing up is wasted spend and "always standard" wins. Opus 4.5 clearly beats Sonnet 4.5 (384 vs 356), and there Jev slightly beats always-standard. The gaps are within the error bars.
- **Per-token price misleads.** Opus 4.5 costs 1.67× Sonnet 4.5 per token, but only **1.15× per task**, because it uses fewer tokens. So always-Opus costs about the same as always-Sonnet and solves more.
- **The cascade saves money only on solvable tasks.** Across all 500 tasks it costs **1.35×** always-standard ($0.891 vs $0.658), because tasks nobody can solve pay for three runs. What it buys is more solves (403 vs 356), plus about 1.6 runs of waiting per task.
- **The risk gate catches almost nothing extra here:** 59 escalations, 5 of them Opus-only (8.5%, against a 6.6% base rate). SWE-bench rarely touches auth or payments, so its real value is untested.
- **Jev's own overhead is tiny:** about 2,300 input tokens, 312 ms median, $0.10 per 1,000 tasks.
- **Option 1 was picked on the tune half, but made the default after I had seen test numbers.** It is not confirmed on held-out data; see section 4 of the report.

## For a product like Conductor
Conductor runs Claude Code, Codex and other agents in cloud sandboxes, often for hours, on the user's own keys or subscriptions. An under-routed task wastes a whole agent run plus the developer's review time, which costs far more than the tokens saved.

1. **Pick the default model by measured cost per task, not price per token.** With current models, the top model can cost about the same per task and solve more (Opus 4.5: +15% cost, +28 solved of 500).
2. **Don't ship Jev as an automatic tier picker yet.** On the modern ladder it beat always-standard by a hair (1 vs 7 under-routed of 190, 5% cheaper), but that's inside the error bars and on data I had already looked at. On the older ladder it lost.
3. **Keep Jev's risk gate as a safety feature, not a quality one.** It's cheap (~0.3 s, $0.10 per 1,000 tasks), but SWE-bench can't show it helps. Judge it on real Conductor prompts that touch auth, payments or migrations.
4. **Offer try-cheap-first only where failures are cheap to detect,** such as tasks with tests. Applied everywhere, it costs more (1.35×) and adds wait time.
5. **Re-check on real Conductor prompts.** Your labeled set is the only held-out test that hasn't been looked at.

## What you do next
1. Add your prompts to `data/tasks.jsonl` and your labels to `data/labels.csv` (columns: `id,prompt,label,sure`).
2. Check that `config/costs.json` matches the models your tiers actually use.
3. Run `npm run cli -- split`, then `DECIDER=typesafe npm run cli -- all`.
4. Read `reports/report.md` (tune set). If you change thresholds, copy the sweep's pick into `config/thresholds.json` and commit.
5. When you're done tuning: `npm run cli -- eval --final && npm run cli -- report --final`.

## Things to know
- **OpenRouter:** Jev isn't listed there, and the SDK only talks TypeSafe's own API. `TYPESAFE_BASE_URL` works, but only for a host that serves that API.
- **Risk questions are split up:** "risky area" became 5 separate yes/no questions and "destructive" became 3, as the TypeSafe docs recommend. They're combined in code.
- **Track B caveats:** each model got one attempt, measured cost comes from one agent (mini-SWE-agent, high reasoning), and SWE-bench issues don't look like agent prompts. Treat the numbers as a rough signal.
