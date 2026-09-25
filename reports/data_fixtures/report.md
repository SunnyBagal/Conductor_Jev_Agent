# Jev router evaluation

> [!WARNING]
> **MOCK DECIDER.** Jev answers came from a mock file, not the TypeSafe API. These numbers test the pipeline only and say nothing about Jev.

> [!NOTE]
> Built from **pipeline-test fixtures**, not a real dataset.

## Headline

On the held-out TEST set, Jev under-routed 0/3 (0.0%) of tasks. **Baseline `keywords` matches or beats Jev** (no more under-routing, no higher spend).

- Set: **TEST**, 3 labeled tasks. Test set evaluated **1 time(s)** (see `reports/data_fixtures/test_runs.log`).
- Jev model: mock-fixture (requested `jev-1.13.0`), question set `v1`, router config `1577fbe60d253906`.
- Cost: **config/costs.json is not filled in**, so spend is shown as mean tier rank (cheap=0, standard=1, frontier=2), not money.
- Brackets are Wilson 95% intervals. With small n they are wide; read them.

## Routers compared (test set)

| router | under-routed ↓ | over-routed | exact | exact when sure=no | spend | cheap / standard / frontier |
|---|---|---|---|---|---|---|
| **jev** | 0/3 (0.0%) [0–56%] | 0/3 (0.0%) | 3/3 (100.0%) | 0/0 (n/a) | rank 1.00 | 1 / 1 / 1 |
| length | 2/3 (66.7%) [21–94%] | 0/3 (0.0%) | 1/3 (33.3%) | 0/0 (n/a) | rank 0.00 | 3 / 0 / 0 |
| keywords | 0/3 (0.0%) [0–56%] | 0/3 (0.0%) | 3/3 (100.0%) | 0/0 (n/a) | rank 1.00 | 1 / 1 / 1 |
| always_standard | 1/3 (33.3%) [6–79%] | 1/3 (33.3%) | 1/3 (33.3%) | 0/0 (n/a) | rank 1.00 | 0 / 3 / 0 |
| always_frontier | 0/3 (0.0%) [0–56%] | 2/3 (66.7%) | 1/3 (33.3%) | 0/0 (n/a) | rank 2.00 | 0 / 0 / 3 |

`length` cutoffs 80/120 chars were tuned on the tune set only.

## Jev detail

Confusion matrix (rows = your label, columns = Jev):

| label \ Jev | cheap | standard | frontier |
|---|---|---|---|
| cheap | 1 | 0 | 0 |
| standard | 0 | 1 | 0 |
| frontier | 0 | 0 | 1 |

Prompts you marked `sure=no`: exact 0/0 (n/a), under-routed 0/0 (n/a).

Accuracy by Jev confidence (min of task_type and scope confidence):

| confidence | exact | under-routed |
|---|---|---|
| 0.0–0.5 | 0/0 (n/a) | 0/0 (n/a) |
| 0.5–0.7 | 0/0 (n/a) | 0/0 (n/a) |
| 0.7–0.9 | 3/3 (100.0%) | 0/3 (0.0%) |
| 0.9–1.0 | 0/0 (n/a) | 0/0 (n/a) |

## Threshold sweep (TUNE set only)

1944 threshold settings tried on 5 tune tasks. Rule: cheapest setting with under-routing ≤ 10%. Spend = mean_tier_rank (fill config/costs.json for real cost).

Chosen: `{"risky":0.3,"destructive":0.3,"underspecified":0.5,"needs_exploration":0.5,"scope_up":2,"scope_down":0.5,"task_type_conf":0.9,"scope_conf":0.2}` → under-routed 0/5 (0.0%), exact 3/5 (60.0%), spend 1.400.

| spend | under-routed | exact | key thresholds (risky / destructive / task_type_conf / scope_conf) |
|---|---|---|---|
| 0.600 | 1/5 (20.0%) | 4/5 (80.0%) | 0.3 / 0.3 / 0.3 / 0.2 |
| 1.400 | 0/5 (0.0%) | 3/5 (60.0%) | 0.3 / 0.3 / 0.9 / 0.2 |

![Savings vs under-routing](sweep.svg)

## Example routings (test set)

**fx02** — ✅ correct: label `cheap` (sure=yes), Jev `cheap`
> FIXTURE: rename the variable usr to user in src/profile.ts

Reason: cheap: task_type=trivial_edit (conf 0.90) -> cheap

**fx04** — ✅ correct: label `standard` (sure=yes), Jev `standard`
> FIXTURE: add a --json flag to the export command that prints the rows as JSON

Reason: standard: task_type=feature_clear_spec (conf 0.88) -> standard

**fx08** — ✅ correct: label `frontier` (sure=yes), Jev `frontier`
> FIXTURE: redesign how auth tokens are refreshed across all our services

Reason: frontier: risky_auth P=0.95 >= 0.50

## Track B: SWE-bench Verified

Skipped. Fill in `config/swebench.json` and run `swebench`.

## Limitations

- **Small sample.** 3 tasks in this set. One or two tasks move a rate by several points; see the intervals.
- **Labels are one person's opinion** of the cheapest tier that would succeed, not measured outcomes.
- **SWE-bench is not representative of agent prompts.** Issues are long and written for humans; submissions differ in agent scaffold, not just model; each is a single attempt.
- **Jev is literal and only sees the prompt text**, not the codebase. A prompt can also talk it into a tier ("just a quick fix").
- **Cost model is optimistic:** it assumes every under-routed failure is noticed and re-run. Silent bad output costs more.
- Thresholds were tuned on the tune set; only `--final` numbers are held out, and every `--final` run is logged.
