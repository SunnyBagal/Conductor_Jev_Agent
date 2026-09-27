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

## Findings with real Jev (2026-09-27, SWE-bench)
The ground truth here is the cheapest model that actually solved each task. Thresholds were tuned on one half and scored on the other half (199 tasks). To reproduce: `npx tsx analysis/trackb.mts`.

| Router (held-out half) | Under-routed ↓ | Avg tier (0 = cheap, 2 = frontier) |
|---|---|---|
| **Always standard (Sonnet)** | **9/199 (4.5%)** | **1.00** |
| Jev, credible-set rule (new default) | 12/199 (6.0%) | 1.22 |
| Jev, confidence round-up (old rule) | 12/199 (6.0%) | 1.24 |
| Keywords | 35/199 (17.6%) | 0.94 |
| Always frontier (Opus) | 0/199 (0.0%) | 2.00 |

- **A baseline beats Jev.** "Always Sonnet" under-routes less *and* costs less. Opus was the only model that could solve just 18 of the 396 solved tasks (4.5%), so the frontier tier rarely pays off.
- **Jev does spot easy tasks.** Haiku solved 64% of the tasks Jev called cheap, against 27% of those it called frontier. But its "frontier" label doesn't predict when Opus is actually needed (2.7–4.1% whichever tier Jev picks).
- **Sending easy tasks to Haiku doesn't pay yet.** A two-tier Jev router that moves 25–37% of tasks to Haiku pushes under-routing to 12–17% on the held-out half.
- **Jev's own overhead is tiny:** about 2,300 input tokens per task, 312 ms median (376 ms p95), **$0.10 per 1,000 tasks**.
- **Option 1 vs option 2:** the credible-set rule matched the old rule's under-routing at lower cost. With untuned thresholds on all 396 tasks, it fixed 8 under-routings and caused 3. It's now the default (`mass_coverage: 0.7`). Option 2 settled the cost question: Jev's overhead doesn't matter.

## For a product like Conductor
Conductor runs Claude Code, Codex and other agents in cloud sandboxes, often for hours, on the user's own keys or subscriptions. An under-routed task wastes a whole agent run plus the developer's review time, which costs far more than the tokens saved.

1. **Don't ship a Jev tier router as the default yet.** On this data, "always standard" is better.
2. **Use Jev as a risk gate on top of standard:** send auth, payments, migrations, infra, data-deletion and git-history prompts to the top model, and use standard for everything else. This is where the risk-gate questions earn their keep, and at $0.10 per 1,000 tasks and ~0.3 s it adds nothing noticeable.
3. **Save money with try-then-escalate, not prediction:** for tasks Jev calls easy, run the cheap model first and escalate if the tests fail. Conductor already runs agents in parallel, so this fits the product.
4. **Re-check on real Conductor prompts.** SWE-bench issues are long bug reports; Conductor prompts are short and casual. Your labeled set will decide it.

## What you do next
1. Add your prompts to `data/tasks.jsonl` and your labels to `data/labels.csv` (columns: `id,prompt,label,sure`).
2. Fill in `config/costs.json`.
3. Run `npm run cli -- split`, then `DECIDER=typesafe npm run cli -- all`.
4. Read `reports/report.md` (tune set). If you change thresholds, copy the sweep's pick into `config/thresholds.json` and commit.
5. When you're done tuning: `npm run cli -- eval --final && npm run cli -- report --final`.

## Things to know
- **OpenRouter:** Jev isn't listed there, and the SDK only talks TypeSafe's own API. `TYPESAFE_BASE_URL` works, but only for a host that serves that API.
- **Risk questions are split up:** "risky area" became 5 separate yes/no questions and "destructive" became 3, as the TypeSafe docs recommend. They're combined in code.
- **Track B caveats:** each model got one attempt, the models are older (3.5 Haiku is much weaker than current Haiku), and SWE-bench issues don't look like agent prompts. Treat the numbers as a rough signal.
