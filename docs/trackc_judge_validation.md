# Judge validation: j1 (claude-opus-5-5, effort medium)

Gold: 40 hand-judged rewrites (r1 random 15, r2 random 15, r2's 10 previously flagged), frozen in `data/trackc_judge_gold.jsonl` before the judge ran.

**Pre-registered requirement:** every gold fix leak labelled exactly `fix_leak`. **8/8 caught, so PASS: the judge can be used.**

Exact agreement: 38/40.

| gold \ judge | clean | fix_leak | cause_hint | location_hint | missing_repro |
|---|---|---|---|---|---|
| **clean** | **20** | 1 | 1 | 0 | 0 |
| **fix_leak** | 0 | **8** | 0 | 0 | 0 |
| **cause_hint** | 0 | 0 | **8** | 0 | 0 |
| **location_hint** | 0 | 0 | 0 | **1** | 0 |
| **missing_repro** | 0 | 0 | 0 | 0 | **1** |

## Disagreements (2)

| set | # | task | gold | judge | judge evidence | gold note |
|---|---|---|---|---|---|---|
| r2_random15 | 14 | `django__django-13568` | clean | **fix_leak** | Should skip the check if the field is included in a total unique constraint. | borderline: 'should skip the check if…' is the requested behaviour (feature request) |
| r2_prev_flagged10 | 1 | `scikit-learn__scikit-learn-12585` | clean | **cause_hint** | `get_params()` gets called on the class itself, missing `self` |  |

The `missing_repro` gold labels and one revised label were judged on 2026-09-28, not in the earlier review rounds (see the `note` column in the gold file).
