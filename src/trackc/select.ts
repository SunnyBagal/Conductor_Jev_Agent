/**
 * Track C task selection: stratified sampling with design weights.
 * Inputs are ONLY information that exists before Track C: the prior (Claude 4.5 ladder,
 * Track B) outcome and SWE-bench's human difficulty. No Track C outcome ever feeds back here.
 */
import { z } from "zod";
import { rng } from "../split.ts";

export const STRATA = ["A_haiku_easy", "A_haiku_hard", "B_sonnet", "C_opus", "D_none_easy", "D_none_hard"] as const;
export type Stratum = (typeof STRATA)[number];

export const TrackCConfigSchema = z.object({
  _note: z.string().optional(),
  seed: z.number().int(),
  repo_cap: z.number().gt(0).max(1),
  prior_ladder: z.object({ haiku: z.string(), sonnet: z.string(), opus: z.string() }),
  allocation: z.record(z.enum(STRATA), z.number().int().min(0)),
  pilot_per_group: z.record(z.enum(STRATA), z.number().int().min(0)),
  rewrite: z.object({ prompt_version: z.string(), max_tokens: z.number().int().positive(), instruction: z.string().min(20) }),
});
export type TrackCConfig = z.infer<typeof TrackCConfigSchema>;

export interface PoolItem {
  id: string;
  difficulty: string | null;
}
export interface Prior {
  haiku: Set<string>;
  sonnet: Set<string>;
  opus: Set<string>;
}

export const TaskRowSchema = z.object({
  id: z.string(),
  repo: z.string(),
  difficulty: z.string().nullable(),
  stratum: z.enum(STRATA),
  pool: z.number().int(),
  take: z.number().int(),
  weight: z.number(),
  rank: z.number().int(),
  pilot: z.boolean(),
});
export type TaskRow = z.infer<typeof TaskRowSchema>;

const easy = (d: string | null) => d === "<15 min fix";
export const repoOf = (id: string) => id.split("__")[0]!;

export function stratumOf(x: PoolItem, p: Prior): Stratum {
  if (p.haiku.has(x.id)) return easy(x.difficulty) ? "A_haiku_easy" : "A_haiku_hard";
  if (p.sonnet.has(x.id)) return "B_sonnet";
  if (p.opus.has(x.id)) return "C_opus";
  return easy(x.difficulty) ? "D_none_easy" : "D_none_hard";
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Take `take` items from a shuffled stratum, capping any single repo at ceil(cap * take).
 * If the cap leaves too few items, the shortfall is filled from the skipped ones in order.
 */
export function cappedTake<T extends { id: string }>(shuffled: readonly T[], take: number, cap: number): T[] {
  if (take >= shuffled.length) return [...shuffled];
  const limit = Math.max(1, Math.ceil(cap * take));
  const counts = new Map<string, number>();
  const out: T[] = [];
  const skipped: T[] = [];
  for (const x of shuffled) {
    if (out.length === take) break;
    const r = repoOf(x.id);
    if ((counts.get(r) ?? 0) >= limit) skipped.push(x);
    else {
      out.push(x);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  for (const x of skipped) if (out.length < take) out.push(x);
  return out;
}

export function selectTasks(pool: readonly PoolItem[], prior: Prior, cfg: TrackCConfig): TaskRow[] {
  const rand = rng(cfg.seed);
  const rows: TaskRow[] = [];
  for (const s of STRATA) {
    const members = pool.filter((x) => stratumOf(x, prior) === s).sort((a, b) => a.id.localeCompare(b.id));
    const take = Math.min(cfg.allocation[s] ?? 0, members.length);
    const chosen = cappedTake(shuffle(members, rand), take, cfg.repo_cap);
    const pilotN = cfg.pilot_per_group[s] ?? 0;
    chosen.forEach((x, rank) =>
      rows.push({
        id: x.id,
        repo: repoOf(x.id),
        difficulty: x.difficulty,
        stratum: s,
        pool: members.length,
        take,
        weight: members.length / take,
        rank,
        pilot: rank < pilotN,
      }),
    );
  }
  return rows;
}
