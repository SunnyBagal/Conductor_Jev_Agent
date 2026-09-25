import { z } from "zod";
import { readJson } from "./data.ts";

export const PolicyThresholdsSchema = z.object({
  /** Noul P(yes) at or above which any risky-area question forces frontier. */
  risky: z.number().min(0).max(1),
  /** Noul P(yes) at or above which any destructive question forces frontier. */
  destructive: z.number().min(0).max(1),
  /** Noul P(yes) at or above which the tier is at least standard. */
  underspecified: z.number().min(0).max(1),
  needs_exploration: z.number().min(0).max(1),
  /** Expected scope score (0..3) at or above which the tier goes up one. */
  scope_up: z.number().min(0).max(3),
  /** Expected scope score at or below which a confident localized bug fix goes to cheap. */
  scope_down: z.number().min(0).max(3),
  /** Choice/Score confidence below which the tier rounds UP one. */
  task_type_conf: z.number().min(0).max(1),
  scope_conf: z.number().min(0).max(1),
});
export type PolicyThresholds = z.infer<typeof PolicyThresholdsSchema>;

const GridSchema = z.record(z.string(), z.array(z.number()).min(1));

export const ThresholdsFileSchema = z.object({
  _note: z.string().optional(),
  policy: PolicyThresholdsSchema,
  split: z.object({ seed: z.number().int(), test_fraction: z.number().gt(0).lt(1) }),
  sweep: z.object({
    max_under_routing: z.number().min(0).max(1),
    grid: GridSchema,
    length_cutoffs: z.array(z.number().int().positive()).min(2),
  }),
});
export type ThresholdsFile = z.infer<typeof ThresholdsFileSchema>;

export const CostsSchema = z.object({
  _note: z.string().optional(),
  cheap: z.number().positive().nullable(),
  standard: z.number().positive().nullable(),
  frontier: z.number().positive().nullable(),
  router_overhead: z.number().min(0).default(0),
});
export type Costs = z.infer<typeof CostsSchema>;
export interface FilledCosts {
  cheap: number;
  standard: number;
  frontier: number;
  router_overhead: number;
}

export const SwebenchConfigSchema = z.object({
  _note: z.string().optional(),
  split: z.literal("verified"),
  sample: z.number().int().positive(),
  seed: z.number().int(),
  tiers: z.object({
    cheap: z.array(z.string()),
    standard: z.array(z.string()),
    frontier: z.array(z.string()),
  }),
});
export type SwebenchConfig = z.infer<typeof SwebenchConfigSchema>;

export const CONFIG_PATHS = {
  thresholds: "config/thresholds.json",
  costs: "config/costs.json",
  swebench: "config/swebench.json",
} as const;

export const loadThresholds = (path: string = CONFIG_PATHS.thresholds) => readJson(path, ThresholdsFileSchema);
export const loadCosts = (path: string = CONFIG_PATHS.costs) => readJson(path, CostsSchema);
export const loadSwebenchConfig = (path: string = CONFIG_PATHS.swebench) => readJson(path, SwebenchConfigSchema);

/** Returns filled costs, or null if the user has not filled in config/costs.json yet. */
export function filledCosts(c: Costs): FilledCosts | null {
  if (c.cheap === null || c.standard === null || c.frontier === null) return null;
  return { cheap: c.cheap, standard: c.standard, frontier: c.frontier, router_overhead: c.router_overhead };
}
