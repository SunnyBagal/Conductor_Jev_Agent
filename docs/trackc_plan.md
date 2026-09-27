# Track C — Step 0 feasibility and design (2026-09-27)

Nothing has been run yet.

**Decided 2026-09-27:** SWE-bench Verified with the stratified sample below; Claude Code run headless via Harbor; Modal sandboxes; a control arm in the pilot (Sonnet 5 on the original issue text for the same 10 tasks).

## Models (`config/models.json`, confirmed on platform.claude.com)
| Tier | Model | API ID | $/MTok in / out |
|---|---|---|---|
| cheap | Haiku 4.5 | `claude-haiku-4-5-20251001` | 1 / 5 |
| standard | Sonnet 5 | `claude-sonnet-5` | 2 / 10 (the "introductory" price is now permanent) |
| top | Opus 5.5 | `claude-opus-5-5` | 4 / 20 |
| ceiling | Fable 5.1 | `claude-fable-5-1` | 10 / 50 (needs 30-day data retention) |

**Fable 5.1 is not stronger than Opus 5.5 at coding.** Anthropic's Opus 5.5 table scores Opus 5.5 higher on every coding benchmark listed (Terminal-Bench 4.0: 66.4% vs 55.8%). So tiers are ordered **by price**, the label is the *cheapest model that solved it*, and nothing assumes a pricier model solves everything a cheaper one does.

## Existing results and published scores
- **SWE-bench/experiments:** only Haiku 4.5 has per-instance results (the mini-SWE-agent run used in Track B). There's nothing for Sonnet 5, Opus 5.5 or Fable 5.1. Since 2025-11-18, Verified only accepts academic submissions, so none are likely to appear.
- **Published Verified scores:** Haiku 4.5 **73.3%** (Anthropic, 50-trial average) and 67% under mini-SWE-agent. Anthropic's posts for Sonnet 5 and Opus 5.5 don't report SWE-bench Verified at all. I couldn't read the Scale Pro leaderboard (it renders in JavaScript), so I'm not quoting Pro scores.
- **The cheap model is near saturation:** in a random Verified sample, about 67% of tasks would come from the group the previous Haiku already solved.

## Harder task set: SWE-bench Pro vs Verified
**Pro v2** (released 2026-09-22): 642 tasks, 11 repos, several languages, newer and less likely to be in training data.
**The catch:** each Pro task ships `requirements` and an exact `interface` (file paths and function names), and the hidden tests call those names. A casual 1–3 sentence rewrite of the issue alone drops them, so many tasks become unsolvable by *any* model, and the labels would measure what the rewrite lost, not model capability.

**Recommendation: Verified plus the selection scheme below.** Verified issues were checked by humans to be solvable from the issue text alone, which makes it the right base for casual rewrites. The trade-off is that it's older and more likely to be in training data. Pro only makes sense if the casual prompt may keep the interface names, which changes the "issue text only" rule **(you)**.

## Selection: stratified sampling with design weights
A pure random sample would give mostly "cheap" labels. Picking tasks by *these* models' outcomes would be circular. Instead:

1. **Strata** use only information that exists *before* Track C:
   - the previous generation's result from Track B (Haiku 4.5 solved it / needed Sonnet 4.5 / needed Opus 4.5 / none solved), and
   - SWE-bench's human difficulty estimate (under 15 min vs 15 min or more).
2. **Oversample the rare, hard strata** so every tier has enough labels to measure. Example for N = 200:

| Stratum | Pool | Take | Weight |
|---|---|---|---|
| Haiku 4.5 solved, easy | 161 | 36 | 4.47 |
| Haiku 4.5 solved, hard | 174 | 46 | 3.78 |
| needed Sonnet 4.5 | 35 | 35 (all) | 1.00 |
| needed Opus 4.5 | 33 | 33 (all) | 1.00 |
| none solved, easy | 17 | 10 | 1.70 |
| none solved, hard | 80 | 40 | 2.00 |

3. **Repo cap:** Django is 231 of 500 tasks, so each stratum is capped at 35% from any one repo.
4. **Every metric is reported twice:** unweighted (on the sample) and **weighted back to all 500** with the stratum weights, so oversampling doesn't distort the headline numbers.
5. The pilot takes 2 tasks from each of 5 strata (10 in total).

Caveat: the Track B outcomes include Haiku 4.5 itself, run with a different agent and the original issue text. Using them as a *sampling* variable is statistically valid with weights, and they are never used as labels.

## Agent scaffold: Claude Code, run headless, via Harbor
- **Why:** Conductor runs Claude Code, so it's the harness whose tier needs matter. It takes all four models via `--model`, reports the cost of each run, and Harbor ships it (`claude_code` agent) with SWE-bench Verified (`swebench-verified@1.0`) and web search disabled.
- **Trade-off:** results aren't comparable to the bash-only leaderboard, and Claude Code changes between versions, so the version gets pinned.
- **The alternative, mini-SWE-agent,** is neutral and comparable to the leaderboard, but it isn't what Conductor users actually run.

## Compute
This Mac can't run it (arm64, 16 GB RAM, 50 GB free, Docker not running; SWE-bench images are x86 and large). The run needs Harbor's cloud sandboxes: **Modal or Daytona (you, needs an account)**. It also needs `ANTHROPIC_API_KEY` with access to all four models.

## Rough cost (the pilot will measure the real figure)
The anchors are Track B's measured mini-SWE-agent costs, scaled by price. Claude Code may use more tokens.
- Per task, one attempt on all 4 models: about **$3**, with Fable ~$1.50 the biggest and least certain part.
- Full run: 2 attempts plus a 3rd where models disagree ≈ 2.4 attempts, so N = 200 ≈ **$1,400 (range $900–2,500)**, plus sandbox compute.
- Pilot: 10 tasks × 4 models ≈ **$30**.
- **Suggested control arm:** 10 extra runs of Sonnet 5 on the *original* issue text, about $5, to measure how much the casual rewrite loses **(you)**.

## Rewriter (Step 1)
`claude-sonnet-4-6` at temperature 0. It isn't one of the evaluated models, and Sonnet 5, Opus 5.5 and Fable 5.1 reject a temperature setting. It sees only the issue text. The model ID, prompt version and output go to `data/trackc_prompts.jsonl`.

## Pre-registered before any runs (2026-09-27)
**Hypothesis (H1):** Fable 5.1 is more *consistent* across attempts than Opus 5.5, even if its single-attempt solve rate is lower.
- **Measure:** on tasks where both models have 3 valid attempts, a task is *inconsistent* for a model if it passed 1/3 or 2/3.
- **Test:** paired sign test on the discordant tasks (consistent for one model, inconsistent for the other), two-sided, α = 0.05. H1 is supported only if Fable has significantly fewer inconsistent tasks. Anything else gets reported as "not supported", with the counts.

**Attempts:** 3 per task per model on the casual prompt, for every model and every task.

**How an attempt is counted:**
- `pass` / `fail`: the hidden SWE-bench tests pass or fail. Only these count as **valid** attempts.
- `refused`: the model returned `stop_reason: refusal`. Logged and counted separately, and **left out of the solve rates**.
- `fallback`: a turn was answered by a model other than the one requested (for example, an automatic fallback after a refusal). Logged separately and left out of the solve rates.
- `error`: a harness or sandbox failure. Logged, retried up to 2 times, then left out.

**Per task and model:**
- *Majority pass:* at least 2 valid attempts, and passes > valid / 2.
- *All pass:* at least 2 valid attempts, and passes = valid.
- With fewer than 2 valid attempts, the result is *undetermined* and counted separately.

**Two labels per task,** tiers ordered by price (cheap < standard < top < ceiling):
- `label_majority`: the cheapest tier with a majority pass.
- `label_all`: the cheapest tier with an all pass.
- `unsolved` if no tier passes. The label is flagged *uncertain* if a cheaper tier is undetermined.
- Router results are reported under both labels.

**Per model:** majority-pass rate, all-pass rate, the pass-count distribution (0/3, 1/3, 2/3, 3/3), refusal count, harness-error count, and spend (total, per task, and Fable's share of the total).

**Quality proxies per patch:** lines changed, files touched, and whether the existing tests still pass (SWE-bench `PASS_TO_PASS`, a curated set of the repo's existing tests, not its full suite). A resolved patch passes these by definition, so the proxy only separates failing patches.

**Blind review:** 15 random tasks where both Opus 5.5 and Fable 5.1 had a majority pass. For each model I take its first passing patch and label the two A/B in random order. The key goes in `data/private/blind_key.json` (git-ignored), not next to the review.

**Updated cost:** 3 attempts × 4 models is about $9 per task, so 200 tasks ≈ **$1,800 (range $1,200–3,000)**. Pilot: 10 tasks × 4 models × 3 attempts plus the control arm (10 × 3) ≈ **$100**.

## Pre-registration amendment 1 (2026-09-27, before any runs)
Where these conflict with the section above, this amendment takes precedence.

### Full run uses cascade labeling; the pilot stays a full grid
- **Full run:**
  - Haiku 4.5 × 3 on every task.
  - Sonnet 5 × 3 only where Haiku did not pass 3/3.
  - Opus 5.5 × 3 **and** Fable 5.1 × 3 only where Sonnet did not pass 3/3.
  - The gate is the literal pass count (3 of 3). A refused or errored attempt therefore always sends the task up a tier, which errs on the side of more data.
- **Both labels stay computable.** If Haiku passes 3/3, both labels are cheap. Otherwise Sonnet runs, and if Sonnet passes 3/3 both labels are settled by Haiku and Sonnet. Otherwise all four models ran.
- **Pilot:** a full grid (10 tasks × 4 models × 3 attempts, plus the control arm). The report reruns the labels as if the cascade had been used and lists every mismatch. Mismatches should be zero by construction, so any mismatch means a bug.
- **What the cascade design can no longer claim:**
  - How consistent or accurate Sonnet, Opus and Fable are on tasks a cheaper model already aced. Their per-model numbers only describe the escalated, harder subset, so they aren't comparable to Haiku's numbers on the full sample.
  - Whether a higher tier *fails* where a cheaper tier passed 3/3, because it's never run there.
  - "Did the routed model itself solve it" for a router that sends a task to a tier that never ran on it. Those cells are reported as *not observed*, not assumed.
  - Measured cost per task for the higher tiers on easy tasks. Their costs come only from harder tasks, so they overstate what those models would cost on average.
  - The Opus-vs-Fable test covers escalated tasks only.

### Consistency
- **Primary:** all-3-pass rate among tasks the model passed at least once, i.e. (3/3) ÷ (1/3 + 2/3 + 3/3).
- **Secondary:** the earlier "inconsistent = passed 1/3 or 2/3" measure.
- **Paired Opus-vs-Fable test:** only tasks where both models have 3 valid attempts and each passed at least once. A task is discordant when exactly one of them passed 3/3. Two-sided sign test, α = 0.05.
- **Unweighted.** H1 is a paired, within-task comparison of model behaviour, not an estimate of how common something is. Design weights would inflate the variance, break the counting that the sign test relies on, and emphasise whichever strata were undersampled. The report states the stratum makeup of the tested tasks instead.

### Minimum evidence
- **N_min = 20 discordant tasks.** With the sign test at α = 0.05, 20 gives 80% power to detect a 4:1 split in Fable's favour (at 10, power is only 38%).
- With fewer than 20, the report says **"inconclusive — N discordant tasks"**, never "not supported".

### Fallback models
- Claude Code has `--fallback-model` (used when the model is overloaded or unavailable), and Harbor exposes it. There's no "off" switch, so disabling it means **never passing the flag**. Each run records its launch command and `fallback_model: null`.
- Claude Code also calls a small, fast model for background work and runs subagents. For each run, `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` are all pinned to that tier's model.
- **Backstop:** if any logged turn names a different model, the run is marked `fallback` and left out of the solve rates.
- Cost comes from Claude Code's own `total_cost_usd`. The source of each run's cost is recorded, and runs with no cost are counted.

### Cost now includes Modal compute
- **The earlier estimates were API spend only.** Harbor runs in Modal Sandboxes at $0.00003942 per core-second and $0.00000667 per GiB-second (modal.com/pricing, retrieved 2026-09-27). That's about $0.06–0.20 per run for 1–2 cores, 4–8 GiB and 15–25 minutes.
- **Pilot:** 150 runs, so about **$9–30 of Modal on top of ~$100 in API**.
- **Full grid, 200 tasks (2,400 runs):** about $140–475 of Modal on top of ~$1,800 in API.
- The post-pilot projection will price full grid, cascade (200 tasks) and cascade (100 tasks), each as API plus Modal, using the pilot's measured costs and wall times.
