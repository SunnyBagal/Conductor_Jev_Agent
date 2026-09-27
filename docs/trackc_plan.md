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
