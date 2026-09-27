# Track C write-up: casual prompts with outcome labels (frozen 2026-09-28)

**Status: stopped before any agent runs.** All code, data, rewrites, judge outputs, exclusions and the Harbor harness code are kept. The frozen state is git tag `trackc-frozen`.

## The goal
Label SWE-bench Verified tasks with the cheapest current model (Haiku 4.5 → Sonnet 5 → Opus 5.5 → Fable 5.1) that solves them from a **short, casual, Conductor-style prompt**, then test whether Jev can predict that label.

The first step was turning each issue into a casual prompt that **doesn't leak the fix**. That step failed.

## What we tried
| Version | Method | Result |
|---|---|---|
| r1 | One LLM call, issue text → casual message | Rejected. In 15 random: 4 fix leaks, 3 cause/location hints. Regex audit flagged 66/200. |
| r2 | r1 + "describe only the symptom; don't guess cause, fix or location" + 4 style variants | Failed pre-set criteria. In 15 random: 3 fix leaks (limit 0), 4 hints (limit 2). The regex audit passed (7/200) but missed 5 of those 7, so regex auditing was dropped. |
| r3 | Two stages: (1) extract symptom facts into JSON with no cause/fix fields; (2) rewrite from that JSON only, never seeing the issue | Failed. The judge rated **86/200 rewrites not clean** (26 fix leaks, 37 cause hints, 9 location hints, 14 missing reproductions; limit 19). |

**The judge:** Opus 5.5, labelling each message clean / fix_leak / cause_hint / location_hint / missing_repro. It was validated on 40 hand-judged rewrites frozen beforehand: **all 8 fix leaks caught, 38/40 agreement.** Both disagreements were stricter than the hand label.

## Main finding
**SWE-bench issues often contain their own fix,** and rewriting them into casual prompts carries it through at the rates above, even with a two-stage pipeline:
- In r3, **23 of 200 Stage 1 fact files already contained a fix leak** (and 22 a location hint). Stage 1 tended to restate the report's proposed fix as "expected behaviour", and Stage 2 then passed it on.
- **Style matters:** "rambly" was worst (30/51 not clean).

## Why we stopped
1. **The pre-registered stopping rule triggered.** r3 failed, so there's no r4. Every flagged task was excluded: **92/200**, leaving 108.
2. **The exclusions are biased in a way reweighting can't fix.** Tasks are dropped for properties of their issue text, such as proposing a fix or requesting a feature. Those correlate with difficulty *inside* each stratum, and the stratum weights only correct how many tasks come from each stratum, not which ones.
3. **The judge has a known defect:** it treats a *requested feature* as a fix leak (validation case `django-13568`, and several r3 cases). So feature requests are over-excluded.
4. **No budget for agent runs.** The Anthropic budget is now $0.

## What finishing would take
- **Pilot as designed** (10 tasks × 4 models × 3 attempts + control arm): about **$100 API + $9–30 Modal**.
- **Full run:**
  - Full grid (200 tasks): about $1,800 API + $140–475 Modal.
  - Cascade on the 108 remaining tasks: roughly **$400–500 API + $45–140 Modal**. This is a rough guess, since no pilot ran to measure per-run cost.
- **The judge's feature-request defect would need fixing and re-validating** before its exclusions could be trusted.
- **Better alternative: real user prompts** instead of synthetic rewrites. Prompts people actually typed (Track D) don't carry a fix they never knew. The trade-offs are a small n and labels from one person's judgement.

## Total API spend
| Item | Calls | Cost |
|---|---|---|
| Rewrites r1, r2 (`claude-sonnet-4-6`) | 400 | $1.214 |
| r3 Stage 1 + Stage 2 (`claude-sonnet-4-6`) | 400 | $1.630 |
| Judge validation (`claude-opus-5-5`) | 40 | $0.432 |
| **Judge on all 400 r3 outputs (`claude-opus-5-5`)** | 400 | **$4.545** |
| **Anthropic total** | | **$7.821** |
| Jev (TypeSafe), all tracks (8 fixtures + 500 SWE-bench) | 508 | $0.049 |
| Modal (never set up, no runs) | 0 | $0 |

- **The Opus judging run finished before any budget cap existed;** the cap arrived mid-run. The ledger is `data/spend_ledger.jsonl`.
- Costs are from logged token usage at list prices; the Anthropic invoice is the authority.
- The Anthropic budget is now **$0**, and every call is blocked in code (`config/budget.json`, `src/budget.ts`).
