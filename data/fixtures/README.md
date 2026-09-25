# FIXTURES — pipeline tests only

These 8 tasks are **not a dataset**. They exist so the whole pipeline runs end to end with
`DECIDER=mock` and no API keys. Labels are deliberately obvious.

`mock_answers.jsonl` holds hand-made "Jev" answers. They are NOT real Jev output. `fx07` is a
deliberate mistake (it routes a flaky-CI investigation to cheap) so the report shows a failure.

Run: `npm run cli -- all --data-dir data/fixtures`
