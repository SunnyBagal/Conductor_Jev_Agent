# Track D protocol: real tasks on my own repos (pre-registered 2026-09-28, before any runs)

**Goal:** get honest labels (the cheapest model that actually succeeded) on real prompts I'd really give an agent, then see whether Jev's tier matches.

**Who runs what:** I run every agent attempt myself in Claude Code on my subscription. No Anthropic API calls; this repo's Anthropic budget is $0 and blocked in code. The only automated calls are Jev (TypeSafe), one per task.

## 1. Tasks
- **10–15 real pending tasks** from my own repos: things I actually need done.
- **The prompt is written before any run,** the way I'd really type it, and is never edited afterwards. Registration stores a hash of it.
- **Each task also records, at registration:** the repo, the base commit, and a **test command** that decides "tests pass" (an existing suite or a check written in advance).
- **All tasks are registered before the first attempt of any task.** Nothing is added after results start coming in, so the task list can't drift toward easy or hard ones.
- Registration: `npm run cli -- trackd-add-task --id d01 --repo myrepo --test-cmd "npm test" --prompt "..."`

## 2. Jev prediction (before any attempt)
- `npm run cli -- trackd-jev` runs Jev on every registered prompt, using the thresholds in `config/thresholds.json` as they are now (credible-set rule 0.7). **No tuning on Track D;** n is far too small.
- The predictions are written to `data/trackd_jev.jsonl` and **committed before the first attempt.** Logging an attempt is refused until they exist.

## 3. Attempts: the cascade
- **Order: Haiku 4.5 → Sonnet 5 → Opus 5.5.** Stop at the first success. A higher model only runs after the one below failed.
- **Every attempt starts from the task's base commit in a fresh branch or worktree.** Same prompt, pasted as is. **No follow-up guidance** during a run: approving permissions is fine, hints are not.
- The same Claude Code version is used for all attempts, and each attempt logs it.

## 4. Success
**Success = the test command passes AND I'd merge the diff without rewriting it.**
- "Without rewriting" allows only cosmetic touch-ups (naming, formatting, at most ~5 lines). Anything more is a failure.
- `tests_pass` and `would_merge` are recorded separately; `success` is derived from both.

## 5. What gets logged per attempt (`data/trackd_attempts.jsonl`)
`task_id, model, tests_pass, would_merge, success, review_minutes, notes, claude_code_version, logged_at`

`npm run cli -- trackd-log --id d01 --model haiku --tests-pass yes --would-merge no --review-min 6 --notes "..."`

The logger enforces the rules: registered tasks only, cascade order, nothing logged after a success, no repeated model, and Jev predictions must exist first.

## 6. Labels and comparison
- **Label = the cheapest model that succeeded** (Haiku = cheap, Sonnet = standard, Opus = frontier), or `unsolved` if all three failed.
- **Compared:** Jev's tier, always-cheap, always-standard, always-frontier, and the cascade actually run.
- **Reported:** counts of exact / under-routed / over-routed, the number of unsolved tasks, cascade runs per task, and total review minutes.
- **Counts only, with n shown everywhere.** No percentages without their counts.
- **"Would the routed model have succeeded?"** is only known where that model actually ran. Where it didn't (for example, Opus on a task Haiku already solved), it's reported as *not observed*, never assumed.

## 7. Limitations (stated in the report)
- **Small n** (10–15): any difference of a task or two is noise.
- **My own repos and my own tasks:** not representative of Conductor users in general.
- **My own judgement of "would merge"** is the ground truth, and I know which model I'm reviewing (no blinding).
- **One attempt per model:** run-to-run variation isn't measured.
- **The cascade order means higher models never run on tasks a cheaper one solved,** so their success there is unobserved.
- **Subscription usage** has no per-run cost, so the report can't give dollar figures, only runs and review minutes.

## Amendment 1 (2026-09-28, before any task is registered)
- **Tasks with no automated tests** (new features, UI work) may register a **written manual check** instead of a test command: numbered steps plus the expected result.
- **The check is locked at registration.** A lock hash covers the prompt and the check together, and changing either after registration isn't possible.
- **Every task has exactly one kind of check:** `test_cmd` or `manual-check`.
- For manual-check tasks, `tests_pass` means "every step was followed and the expected result was seen".
- **The report marks these tasks `manual-check`,** and gives a separate count of successes that rest on my judgement alone (manual check plus "would merge"), so readers can discount them.
