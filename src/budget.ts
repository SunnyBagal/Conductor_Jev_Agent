/**
 * Hard Anthropic spend cap. Every call made through budgetedClient() is checked BEFORE it is sent
 * (worst case: estimated input + max_tokens output) and recorded AFTER with actual usage.
 * A run whose total estimate exceeds the approval threshold must be approved explicitly.
 */
import { existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { appendJsonl, readJsonl } from "./data.ts";

export const BUDGET_FILE = "config/budget.json";
export const LEDGER_FILE = "data/spend_ledger.jsonl";

const BudgetSchema = z.object({
  cap_usd: z.number().min(0),
  approval_threshold_usd: z.number().positive(),
  batch_discount: z.number().min(0).max(1),
  /** $/MTok by model id prefix. */
  prices: z.record(z.string(), z.object({ input: z.number(), output: z.number() })),
});
export type Budget = z.infer<typeof BudgetSchema>;

const LedgerRowSchema = z.object({
  at: z.string(),
  what: z.string(),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  usd: z.number(),
  batch: z.boolean(),
  counts_toward_cap: z.boolean(),
});

export const loadBudget = (): Budget => BudgetSchema.parse(JSON.parse(readFileSync(BUDGET_FILE, "utf8")));

export function priceOf(b: Budget, model: string) {
  const key = Object.keys(b.prices).find((k) => model.startsWith(k));
  if (!key) throw new Error(`budget: no price for model "${model}" in ${BUDGET_FILE}`);
  return b.prices[key]!;
}

export const usd = (b: Budget, model: string, inTok: number, outTok: number, batch: boolean) => {
  const p = priceOf(b, model);
  return ((inTok * p.input + outTok * p.output) / 1e6) * (batch ? 1 - b.batch_discount : 1);
};

export function spentTowardCap(): number {
  if (!existsSync(LEDGER_FILE)) return 0;
  return readJsonl(LEDGER_FILE, LedgerRowSchema).filter((r) => r.counts_toward_cap).reduce((s, r) => s + r.usd, 0);
}

export class BudgetError extends Error {}

/** Throws if spending `estimate` more would exceed the cap. */
export function assertCanSpend(b: Budget, estimate: number, what: string) {
  const spent = spentTowardCap();
  if (spent + estimate > b.cap_usd + 1e-9)
    throw new BudgetError(`budget: ${what} needs up to $${estimate.toFixed(4)}, but $${spent.toFixed(4)} of the $${b.cap_usd.toFixed(2)} cap is used. Stopping.`);
}

/** A run estimated above the threshold needs --approve-spend=<usd> at least as large as the estimate. */
export function assertApproved(b: Budget, estimate: number, approvedUsd: number | undefined, what: string) {
  if (estimate <= b.approval_threshold_usd) return;
  if (approvedUsd === undefined || approvedUsd + 1e-9 < estimate)
    throw new BudgetError(`budget: ${what} is estimated at $${estimate.toFixed(3)} (> $${b.approval_threshold_usd} threshold). Needs explicit approval (--approve-spend=${estimate.toFixed(2)}).`);
}

export function record(b: Budget, what: string, model: string, inTok: number, outTok: number, batch: boolean) {
  appendJsonl(LEDGER_FILE, { at: new Date().toISOString(), what, model, input_tokens: inTok, output_tokens: outTok, usd: usd(b, model, inTok, outTok, batch), batch, counts_toward_cap: true });
}

const approxTokens = (x: unknown) => Math.ceil(JSON.stringify(x ?? "").length / 3.5);

type CreateParams = { model: string; max_tokens: number; system?: unknown; messages: unknown };

/**
 * A client whose messages.create / messages.parse pre-check the worst-case cost against the cap
 * and record actual usage afterwards. Same call shapes as the SDK.
 */
export function budgetedClient(what: string, b: Budget = loadBudget()): Anthropic {
  const inner = new Anthropic();
  const wrap = <T extends (p: never, ...rest: never[]) => Promise<{ model: string; usage: { input_tokens: number; output_tokens: number } }>>(fn: T) =>
    (async (params: CreateParams, ...rest: unknown[]) => {
      const worst = usd(b, params.model, approxTokens(params.system) + approxTokens(params.messages), params.max_tokens, false);
      assertCanSpend(b, worst, what);
      const res = await (fn as unknown as (p: CreateParams, ...r: unknown[]) => ReturnType<T>)(params, ...rest);
      record(b, what, params.model, res.usage.input_tokens, res.usage.output_tokens, false);
      return res;
    }) as unknown as T;
  const messages = Object.create(inner.messages) as Anthropic["messages"];
  messages.create = wrap(inner.messages.create.bind(inner.messages)) as Anthropic["messages"]["create"];
  messages.parse = wrap(inner.messages.parse.bind(inner.messages)) as Anthropic["messages"]["parse"];
  const client = Object.assign(Object.create(inner) as Anthropic, { messages });
  // Beta endpoints are not budget-tracked, so they are blocked rather than silently unmetered.
  Object.defineProperty(client, "beta", {
    get() {
      throw new BudgetError(`budget: ${what} tried a beta endpoint, which the spend guard does not meter. Blocked.`);
    },
  });
  return client;
}
