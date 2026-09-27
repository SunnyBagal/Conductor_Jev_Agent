import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const TIERS = ["cheap", "standard", "frontier"] as const;
export type Tier = (typeof TIERS)[number];
export const TierSchema = z.enum(TIERS);

export const tierIndex = (t: Tier): number => TIERS.indexOf(t);
export const tierAt = (i: number): Tier => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))]!;
export const maxTier = (a: Tier, b: Tier): Tier => (tierIndex(a) >= tierIndex(b) ? a : b);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const TaskSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  source: z.enum(["manual", "own", "swebench"]),
});
export type Task = z.infer<typeof TaskSchema>;

export const LabelSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  label: TierSchema,
  sure: z.enum(["yes", "no"]),
});
export type Label = z.infer<typeof LabelSchema>;

/** One routing decision. Every router (Jev and baselines) writes this shape. */
export const RouteSchema = z.object({
  id: z.string(),
  router: z.string(),
  tier: TierSchema,
  reason: z.string(),
  /** Router's own certainty in [0,1], if it has one. For Jev: min(task_type, scope) confidence. */
  confidence: z.number().min(0).max(1).nullable().default(null),
  /** Versioned model ID that produced the answers (Jev / LLM routers). */
  model: z.string().nullable().default(null),
  answers: z.unknown().optional(),
  cached: z.boolean().optional(),
  /** Real Jev calls only: tokens and wall time of the original (possibly cached) call. */
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
  latency_ms: z.number().optional(),
});
export type Route = z.infer<typeof RouteSchema>;

export const SplitSchema = z.object({
  seed: z.number().int(),
  test_fraction: z.number().gt(0).lt(1),
  labels_sha256: z.string(),
  created_at: z.string(),
  tune: z.array(z.string()),
  test: z.array(z.string()),
});
export type Split = z.infer<typeof SplitSchema>;

// ---------------------------------------------------------------------------
// JSONL
// ---------------------------------------------------------------------------

export function readJsonl<T>(path: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const out: T[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (e) {
        throw new Error(`${path}:${i + 1}: invalid JSON (${(e as Error).message})`);
      }
      const r = schema.safeParse(json);
      if (!r.success) throw new Error(`${path}:${i + 1}: ${z.prettifyError(r.error)}`);
      out.push(r.data);
    });
  return out;
}

export function writeJsonl(path: string, rows: readonly unknown[]): void {
  ensureDir(dirname(path));
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function appendJsonl(path: string, row: unknown): void {
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(row) + "\n");
}

export function readJson<T>(path: string, schema: z.ZodType<T>): T {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const r = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!r.success) throw new Error(`${path}: ${z.prettifyError(r.error)}`);
  return r.data;
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, "" escapes, embedded commas and newlines)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (inQuotes) throw new Error("CSV: unterminated quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

export function readLabelsCsv(path: string): Label[] {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  const expected = ["id", "prompt", "label", "sure"];
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  if (expected.some((c, i) => cols[i] !== c))
    throw new Error(`${path}: header must be "${expected.join(",")}", got "${cols.join(",")}"`);
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const line = i + 2;
    if (r.length !== 4) throw new Error(`${path}: row ${line} has ${r.length} columns, expected 4`);
    const res = LabelSchema.safeParse({
      id: r[0]!.trim(),
      prompt: r[1]!,
      label: r[2]!.trim().toLowerCase(),
      sure: r[3]!.trim().toLowerCase(),
    });
    if (!res.success) throw new Error(`${path}: row ${line}: ${z.prettifyError(res.error)}`);
    if (seen.has(res.data.id)) throw new Error(`${path}: row ${line}: duplicate id "${res.data.id}"`);
    seen.add(res.data.id);
    return res.data;
  });
}

// ---------------------------------------------------------------------------
// Dataset paths
// ---------------------------------------------------------------------------

export interface Paths {
  dataDir: string;
  tasks: string;
  labels: string;
  mockAnswers: string;
  split: string;
  llmLabels: string;
  disagreements: string;
  runsDir: string;
  reportsDir: string;
  testRunsLog: string;
}

/**
 * The main dataset (`data/`) writes to `runs/` and `reports/`. Any other data dir
 * (e.g. `data/fixtures`) writes to `runs/<slug>/` and `reports/<slug>/` so fixture
 * runs never mix with real results.
 */
export function paths(dataDir = "data"): Paths {
  const d = normalize(dataDir).replace(/\/+$/, "");
  const slug = d === "data" ? "" : d.replace(/[^a-zA-Z0-9]+/g, "_");
  const runsDir = slug ? join("runs", slug) : "runs";
  const reportsDir = slug ? join("reports", slug) : "reports";
  return {
    dataDir: d,
    tasks: join(d, "tasks.jsonl"),
    labels: join(d, "labels.csv"),
    mockAnswers: join(d, "mock_answers.jsonl"),
    split: join(d, "split.json"),
    llmLabels: join(d, "llm_labels.jsonl"),
    disagreements: join(d, "disagreements.jsonl"),
    runsDir,
    reportsDir,
    testRunsLog: join(reportsDir, "test_runs.log"),
  };
}

export const routesPath = (p: Paths, router: string): string => join(p.runsDir, `${router}.jsonl`);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export const loadTasks = (p: Paths): Task[] => {
  const tasks = readJsonl(p.tasks, TaskSchema);
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`${p.tasks}: duplicate id "${t.id}"`);
    ids.add(t.id);
  }
  return tasks;
};

/** Labels joined against tasks. Fails if a label's id or prompt does not match tasks.jsonl. */
export function loadLabels(p: Paths, tasks: Task[]): Map<string, Label> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, Label>();
  for (const l of readLabelsCsv(p.labels)) {
    const t = byId.get(l.id);
    if (!t) throw new Error(`${p.labels}: id "${l.id}" is not in ${p.tasks}`);
    if (norm(t.prompt) !== norm(l.prompt))
      throw new Error(`${p.labels}: prompt for "${l.id}" does not match ${p.tasks}`);
    out.set(l.id, l);
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function loadRoutes(p: Paths, router: string): Route[] {
  return readJsonl(routesPath(p, router), RouteSchema);
}
