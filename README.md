# jev-router-eval

Checks whether TypeSafe's **Jev** can send coding-agent prompts to the right model tier (cheap / standard / frontier). The output is an evaluation report, not a production router.

New here? Read **[docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)** first, then **[PLAN_AND_REPORT.md](PLAN_AND_REPORT.md)** for results.

```sh
npm install
npm test                                            # unit tests, no API needed
npm run cli -- all --data-dir data/fixtures         # full pipeline on 8 fixtures (mock Jev)
npm run cli -- --help                               # all commands and options
```

| Where | What |
|---|---|
| `src/questions.ts` | The Jev questions (review these first) |
| `src/policy.ts` | Pure function: answers + thresholds → tier + reason |
| `config/thresholds.json` | Policy thresholds, split seed, sweep grid |
| `config/costs.json` | Official per-token prices by model (source cited); tier costs for `eval` |
| `data/tasks.jsonl`, `data/labels.csv` | Your prompts and labels |
| `reports/report.md` | Generated report |
| `reports/test_runs.log` | One line for every `--final` run |
| `reports/trackb.md` | SWE-bench deep-dive (`npm run cli -- trackb`) |
| `reports/trackb_test_runs.log` | One line for every time the Track B test half is scored |
| `docs/LABELING.md` | Track A labelling rubric |
| `docs/trackc_writeup.md` | Track C write-up (frozen, tag `trackc-frozen`) |
| `docs/trackd_protocol.md` | Track D protocol (real tasks, you run the agents) |
| `config/budget.json` | Anthropic API budget: $0, enforced in code |

Environment variables: `DECIDER=mock|typesafe`, `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `ANTHROPIC_API_KEY` (only for `--with-llm` and `label`).
