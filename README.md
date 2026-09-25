# jev-router-eval

Checks whether TypeSafe's **Jev** can send coding-agent prompts to the right model tier (cheap / standard / frontier). The output is an evaluation report, not a production router.

Start with **[PLAN_AND_REPORT.md](PLAN_AND_REPORT.md)**, a short summary.

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
| `config/costs.json` | Relative cost per tier (**you fill this in**) |
| `data/tasks.jsonl`, `data/labels.csv` | Your prompts and labels |
| `reports/report.md` | Generated report |
| `reports/test_runs.log` | One line for every `--final` run |

Environment variables: `DECIDER=mock|typesafe`, `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `ANTHROPIC_API_KEY` (only for `--with-llm` and `label`).
