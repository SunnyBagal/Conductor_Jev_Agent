/**
 * Decider: where Jev answers come from.
 *   DECIDER=mock      -> MockDecider, reads <data-dir>/mock_answers.jsonl (deterministic, no API).
 *   DECIDER=typesafe  -> TypeSafeDecider, calls the real API via @typesafe-ai/sdk.
 * TYPESAFE_BASE_URL is passed through by the SDK to point it at another host.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { ensureDir, readJsonl, type Task } from "./data.ts";
import { JevAnswersSchema, type JevAnswers } from "./policy.ts";
import { buildState, JEV_MODEL, NOUL_IDS, QUESTION_SET_VERSION, QUESTIONS, TASK_TYPES } from "./questions.ts";

export interface DeciderResult {
  /** Versioned model ID that answered (e.g. "jev-1.13.0"), or "mock" / "mock-hash". */
  model: string;
  answers: JevAnswers;
  cached: boolean;
}

export interface Decider {
  readonly kind: "mock" | "typesafe";
  decide(task: Task): Promise<DeciderResult>;
}

/** The exact request body sent for a task. Used by --dry-run. */
export const requestBody = (task: Task) => ({ model: JEV_MODEL, state: buildState(task.prompt), questions: QUESTIONS });

export const isMockModel = (model: string | null | undefined) => !!model && model.startsWith("mock");

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

export const MockRowSchema = z.object({ id: z.string(), model: z.string().default("mock"), answers: JevAnswersSchema });

export class MockDecider implements Decider {
  readonly kind = "mock";
  readonly #rows: Map<string, z.infer<typeof MockRowSchema>>;

  /** @param hashFallback make up deterministic answers for tasks missing from the mock file. */
  constructor(mockPath: string, private readonly hashFallback = false) {
    const rows = existsSync(mockPath) ? readJsonl(mockPath, MockRowSchema) : [];
    if (!rows.length && !hashFallback)
      throw new Error(`MockDecider: ${mockPath} is missing or empty. Add answers, or set MOCK_FALLBACK=hash.`);
    this.#rows = new Map(rows.map((r) => [r.id, r]));
  }

  async decide(task: Task): Promise<DeciderResult> {
    const row = this.#rows.get(task.id);
    if (row) return { model: row.model.startsWith("mock") ? row.model : `mock:${row.model}`, answers: row.answers, cached: false };
    if (this.hashFallback) return { model: "mock-hash", answers: hashAnswers(task.prompt), cached: false };
    throw new Error(`MockDecider: no mock answers for task "${task.id}" (set MOCK_FALLBACK=hash to generate placeholders)`);
  }
}

/** Deterministic placeholder answers derived from a hash of the prompt. Pipeline testing ONLY. */
export function hashAnswers(prompt: string): JevAnswers {
  const bytes = createHash("sha256").update(prompt).digest();
  let k = 0;
  const u = () => bytes[k++ % bytes.length]! / 255;
  const choice = TASK_TYPES[Math.floor(u() * TASK_TYPES.length) % TASK_TYPES.length]!;
  const scoreLevel = Math.floor(u() * 4) % 4;
  return JevAnswersSchema.parse({
    task_type: { type: "choice", choice, confidence: 0.3 + 0.7 * u(), probabilities: { [choice]: 1 } },
    scope: { type: "score", score: scoreLevel, confidence: 0.3 + 0.7 * u(), probabilities: { [String(scoreLevel)]: 1 } },
    ...Object.fromEntries(NOUL_IDS.map((id) => [id, { type: "noul", noul: u() * 0.6 }])),
  });
}

// ---------------------------------------------------------------------------
// TypeSafe (real API) with a disk cache
// ---------------------------------------------------------------------------

export const CACHE_DIR = ".cache/jev";

/** Cache key: prompt + question-set version + requested model. Reruns cost nothing. */
export const cacheKey = (prompt: string) =>
  createHash("sha256").update(JSON.stringify({ prompt, v: QUESTION_SET_VERSION, model: JEV_MODEL })).digest("hex");

const CacheEntrySchema = z.object({
  question_set_version: z.string(),
  requested_model: z.string(),
  model: z.string(),
  answers: JevAnswersSchema,
  usage: z.unknown().optional(),
  fetched_at: z.string(),
});

export class TypeSafeDecider implements Decider {
  readonly kind = "typesafe";
  readonly #client: TypeSafeClient;

  constructor(private readonly cacheDir = CACHE_DIR) {
    if (!process.env.TYPESAFE_API_KEY?.trim())
      throw new Error("TYPESAFE_API_KEY is not set. Export it, or use DECIDER=mock.");
    // Retries with backoff and retry-after are on by default in the SDK.
    this.#client = new TypeSafeClient({ defaultModel: JEV_MODEL });
    ensureDir(cacheDir);
  }

  async decide(task: Task): Promise<DeciderResult> {
    const file = join(this.cacheDir, `${cacheKey(task.prompt)}.json`);
    if (existsSync(file)) {
      const hit = CacheEntrySchema.parse(JSON.parse(readFileSync(file, "utf8")));
      return { model: hit.model, answers: hit.answers, cached: true };
    }
    const res = await this.#client.systemOne({ model: JEV_MODEL, state: buildState(task.prompt), questions: QUESTIONS });
    const answers = JevAnswersSchema.parse(JSON.parse(JSON.stringify(res.answers)));
    const entry: z.infer<typeof CacheEntrySchema> = {
      question_set_version: QUESTION_SET_VERSION,
      requested_model: JEV_MODEL,
      model: res.model,
      answers,
      usage: res.usage,
      fetched_at: new Date().toISOString(),
    };
    writeFileSync(file, JSON.stringify(entry, null, 2));
    return { model: res.model, answers, cached: false };
  }
}

// ---------------------------------------------------------------------------

export function makeDecider(mockPath: string): Decider {
  const kind = (process.env.DECIDER ?? "mock").trim().toLowerCase();
  if (kind === "typesafe") return new TypeSafeDecider();
  if (kind === "mock") return new MockDecider(mockPath, process.env.MOCK_FALLBACK === "hash");
  throw new Error(`DECIDER must be "mock" or "typesafe", got "${kind}"`);
}
