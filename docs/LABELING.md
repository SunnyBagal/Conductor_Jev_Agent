# Labelling guide (Track A)

You write one row per prompt in `data/labels.csv`:

```csv
id,prompt,label,sure
a001,"fix the typo in the README intro, recieve -> receive",cheap,yes
a002,"the csv export drops the last row when the file has no trailing newline, see export.ts",standard,yes
a003,"login sometimes logs people into the wrong account after the session refactor, figure out why",frontier,no
```

## The rule for `label`
**Pick the cheapest model you'd trust to do this without a re-run.**

| Label | Model class | Typical tasks |
|---|---|---|
| `cheap` | Haiku-class | Mechanical and obvious: typos, renames, docs, config values, a small fix at a named spot. |
| `standard` | Sonnet-class | Normal engineering with a clear goal: a bug fix where you know roughly where, a feature with a clear spec, a contained refactor. |
| `frontier` | Opus-class | Hard or risky: unknown cause, design decisions, cross-cutting changes, vague asks that need judgement, anything touching auth, payments, security, migrations, infra, deleting data, or rewriting git history. |

**Tie-breaker:** if you're torn between two tiers, ask "would I trust the cheaper one without re-running it?" If not, choose the higher one.

## `sure`
- `yes`: you'd give the same label tomorrow.
- `no`: you went back and forth. The report scores these separately.

## Rules
1. **Write prompts the way you'd really type them,** short and casual. Don't polish them for the router.
2. **Label before you see any router output.** Don't run `route` until every row is labelled.
3. **Aim for about 150 prompts.** Every tier needs enough rows: at least ~25 each, or the split can't stratify.
4. **Use unique ids.** Quote any prompt that contains commas or newlines (standard CSV).
5. **Don't edit a label after the split is committed.** If you must, say so in the commit message. The split records a hash of `labels.csv`.

## Then run (no Anthropic calls; Jev only)
```sh
npm run cli -- import-labels          # builds data/tasks.jsonl from labels.csv
npm run cli -- split                  # stratified tune/test split, fixed seed
git add data/labels.csv data/tasks.jsonl data/split.json && git commit -m "Track A labels + split"
DECIDER=typesafe npm run cli -- route # refuses until the split is committed
npm run cli -- baselines && npm run cli -- sweep && npm run cli -- eval && npm run cli -- report
# only when you're done tuning, once:
npm run cli -- eval --final && npm run cli -- report --final
```

`route` makes one Jev call per prompt (150 prompts ≈ $0.015). Anything over 100 new calls stops with an estimate unless you add `--approve-jev`.
