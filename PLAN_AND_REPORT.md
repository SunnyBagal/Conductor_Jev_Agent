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
| Tests | ✅ 53 passing (the policy is tested without any API) |
| Real Jev | ⏳ Needs `TYPESAFE_API_KEY` |
| Your dataset | ⏳ `data/tasks.jsonl` and `data/labels.csv` are empty |
| Costs | ⏳ `config/costs.json` has placeholders; until you fill it in, spend is shown as average tier |
| SWE-bench (Track B) | ✅ Tested against live data; ⏳ you choose which submissions count as which tier in `config/swebench.json` |

**There is no real result yet.** The sample report in `reports/data_fixtures/` uses made-up answers and only proves the pipeline runs.

## What you do next
1. Add your prompts to `data/tasks.jsonl` and your labels to `data/labels.csv` (columns: `id,prompt,label,sure`).
2. Fill in `config/costs.json`.
3. Run `npm run cli -- split`, then `DECIDER=typesafe npm run cli -- all`.
4. Read `reports/report.md` (tune set). If you change thresholds, copy the sweep's pick into `config/thresholds.json` and commit.
5. When you're done tuning: `npm run cli -- eval --final && npm run cli -- report --final`.

## Things to know
- **OpenRouter:** Jev isn't listed there, and the SDK only talks TypeSafe's own API. `TYPESAFE_BASE_URL` works, but only for a host that serves that API.
- **Risk questions are split up:** "risky area" became 5 separate yes/no questions and "destructive" became 3, as the TypeSafe docs recommend. They're combined in code.
- **Track B caveat:** SWE-bench runs use different agent setups, so "which tier solved it" mixes up the model with the agent around it. Treat those numbers as a rough signal.
