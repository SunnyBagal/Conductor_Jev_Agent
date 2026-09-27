/**
 * PURE routing policy: (Jev answers, thresholds) -> tier + reasons. No I/O, no API.
 *
 * Rules, in order:
 *  1. Any risky-area Noul >= t.risky, or any destructive Noul >= t.destructive -> frontier.
 *  2. Base tier from task_type (TASK_BASE_TIER).
 *  3. scope >= t.scope_up -> up one tier. scope <= t.scope_down on a localized bug fix
 *     -> cheap, but ONLY if both task_type and scope are confident.
 *  4. underspecified or needs_exploration above threshold -> at least standard.
 *  5. Low confidence on task_type OR scope -> round UP one tier (once). Never down.
 *
 * With t.mass_coverage > 0 ("credible set" rule), uncertainty is handled differently:
 * rules 2-3 use the fewest task types / scope levels that together hold mass_coverage of
 * Jev's probability and take the HIGHEST tier / level among them, and rule 5 is skipped.
 * A split between two same-tier options then costs nothing, while a thin spread over many
 * options pulls in higher tiers. Still never rounds down below Jev's top choice.
 */
import { z } from "zod";
import type { PolicyThresholds } from "./config.ts";
import { type Tier, tierAt, tierIndex, TIERS } from "./data.ts";
import { DESTRUCTIVE_IDS, NOUL_IDS, RISKY_IDS, TASK_TYPES, type TaskType } from "./questions.ts";

// ---------------------------------------------------------------------------
// Answer shape (validated, because answers come from disk: cache and mock files)
// ---------------------------------------------------------------------------

const Prob = z.number().min(0).max(1);
const NoulAnswer = z.object({ type: z.literal("noul"), noul: Prob });
const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.enum(TASK_TYPES),
  confidence: Prob,
  probabilities: z.record(z.string(), Prob),
});
const ScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number().min(0).max(3),
  confidence: Prob,
  probabilities: z.record(z.string(), Prob),
});

export const JevAnswersSchema = z.object({
  task_type: ChoiceAnswer,
  scope: ScoreAnswer,
  ...(Object.fromEntries(NOUL_IDS.map((id) => [id, NoulAnswer])) as Record<(typeof NOUL_IDS)[number], typeof NoulAnswer>),
});
export type JevAnswers = z.infer<typeof JevAnswersSchema>;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const TASK_BASE_TIER: Record<TaskType, Tier> = {
  trivial_edit: "cheap",
  localized_bug_fix: "standard",
  feature_clear_spec: "standard",
  multi_file_refactor: "standard",
  architecture_design: "frontier",
  investigate_unknown_cause: "frontier",
  other: "standard",
};

export interface Decision {
  tier: Tier;
  reasons: string[];
  reason: string;
  /** min(task_type.confidence, scope.confidence): the router's own certainty. */
  confidence: number;
}

const f2 = (x: number) => x.toFixed(2);

function maxOf<K extends string>(answers: JevAnswers, ids: readonly K[]): { id: K; p: number } {
  let best = { id: ids[0]!, p: -1 };
  for (const id of ids) {
    const p = (answers as unknown as Record<K, { noul: number }>)[id].noul;
    if (p > best.p) best = { id, p };
  }
  return best;
}

/** Fewest keys whose probabilities sum to >= coverage (highest first). Always includes `must`. */
export function credibleSet(probs: Record<string, number>, coverage: number, must: string): string[] {
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Set<string>([must]);
  let mass = probs[must] ?? 0;
  for (const [k, p] of sorted) {
    if (mass >= coverage) break;
    if (!out.has(k)) {
      out.add(k);
      mass += p;
    }
  }
  return [...out];
}

/** Rule 1 on its own: the risky-area / destructive Nouls that clear their thresholds. */
export function riskGateHits(a: JevAnswers, t: Pick<PolicyThresholds, "risky" | "destructive">): string[] {
  const hits: string[] = [];
  const risky = maxOf(a, RISKY_IDS);
  const destructive = maxOf(a, DESTRUCTIVE_IDS);
  if (risky.p >= t.risky) hits.push(`${risky.id} P=${f2(risky.p)} >= ${f2(t.risky)}`);
  if (destructive.p >= t.destructive) hits.push(`${destructive.id} P=${f2(destructive.p)} >= ${f2(t.destructive)}`);
  return hits;
}

export function decide(a: JevAnswers, t: PolicyThresholds): Decision {
  const reasons: string[] = [];
  const confidence = Math.min(a.task_type.confidence, a.scope.confidence);
  const done = (tier: Tier): Decision => ({ tier, reasons, reason: `${tier}: ${reasons.join("; ")}`, confidence });

  // 1. Hard gate: risky or destructive -> frontier.
  reasons.push(...riskGateHits(a, t));
  if (reasons.length) return done("frontier");

  const tt = a.task_type;
  const mass = t.mass_coverage > 0;
  const ttLow = tt.confidence < t.task_type_conf;
  const scLow = a.scope.confidence < t.scope_conf;

  // 2. Base tier from task type (credible set: highest tier among plausible types).
  const types = mass ? (credibleSet(tt.probabilities, t.mass_coverage, tt.choice) as TaskType[]) : [tt.choice];
  let idx = Math.max(...types.map((k) => tierIndex(TASK_BASE_TIER[k] ?? "standard")));
  reasons.push(
    mass && types.length > 1
      ? `task_type plausible {${types.join(", ")}} (${f2(t.mass_coverage)} of mass) -> ${TIERS[idx]}`
      : `task_type=${tt.choice} (conf ${f2(tt.confidence)}) -> ${TIERS[idx]}`,
  );

  // 3. Scope (credible set: also consider the widest plausible level).
  const topLevel = mass ? Math.max(...credibleSet(a.scope.probabilities, t.mass_coverage, String(Math.round(a.scope.score))).map(Number)) : -1;
  const s = Math.max(a.scope.score, topLevel);
  const sure = mass ? types.length === 1 : !ttLow && !scLow;
  if (s >= t.scope_up) {
    idx += 1;
    reasons.push(`scope ${f2(s)} >= ${f2(t.scope_up)}: up one`);
  } else if (s <= t.scope_down && tt.choice === "localized_bug_fix" && sure) {
    idx = 0;
    reasons.push(`scope ${f2(s)} <= ${f2(t.scope_down)} on confident localized fix: cheap`);
  }

  // 4. Floors.
  if (a.underspecified.noul >= t.underspecified && idx < 1) {
    idx = 1;
    reasons.push(`underspecified P=${f2(a.underspecified.noul)}: at least standard`);
  }
  if (a.needs_exploration.noul >= t.needs_exploration && idx < 1) {
    idx = 1;
    reasons.push(`needs_exploration P=${f2(a.needs_exploration.noul)}: at least standard`);
  }

  // 5. Low confidence rounds UP, once (confidence rule only).
  if (!mass && (ttLow || scLow)) {
    const which = [
      ttLow ? `task_type ${f2(tt.confidence)} < ${f2(t.task_type_conf)}` : "",
      scLow ? `scope ${f2(a.scope.confidence)} < ${f2(t.scope_conf)}` : "",
    ].filter(Boolean);
    if (idx < TIERS.length - 1) {
      idx += 1;
      reasons.push(`low confidence (${which.join(", ")}): round up`);
    } else reasons.push(`low confidence (${which.join(", ")}): already frontier`);
  }

  return done(tierAt(idx));
}
