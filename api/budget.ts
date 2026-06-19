import type OpenAI from "openai";
import { config } from "./config.ts";
import { client, model } from "./llm.ts";

// Shared rate/token gate for every Cerebras call. The scorer and the digest draw
// from one free-plan pool (see docs/plans/phase6.md), so they cannot call the
// model independently — they go through callLLM, which reserves budget up front
// and reconciles against the real usage afterward.

export type LlmConsumer = "scorer" | "summary";

export class BudgetExceeded extends Error {
  constructor(consumer: LlmConsumer) {
    super(`LLM budget exhausted for ${consumer}`);
    this.name = "BudgetExceeded";
  }
}

const { limits, daily_token_budget, max_completion_tokens, reasoning_effort } = config.llm;

const reqTimes: number[] = [];
const tokEvents: { t: number; n: number }[] = [];
const dailySpent: Record<LlmConsumer, number> = { scorer: 0, summary: 0 };
let dayAnchor = utcDay();
let parkedUntil = 0;

function utcDay(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function rollDay(): void {
  const today = utcDay();
  if (today !== dayAnchor) {
    dayAnchor = today;
    dailySpent.scorer = 0;
    dailySpent.summary = 0;
  }
}

function prune(now: number): void {
  const dayAgo = now - 86_400_000;
  while (reqTimes.length && reqTimes[0] < dayAgo) reqTimes.shift();
  while (tokEvents.length && tokEvents[0].t < dayAgo) tokEvents.shift();
}

function reqsWithin(now: number, ms: number): number {
  const cutoff = now - ms;
  let n = 0;
  for (let i = reqTimes.length - 1; i >= 0 && reqTimes[i] >= cutoff; i--) n++;
  return n;
}

function toksWithin(now: number, ms: number): number {
  const cutoff = now - ms;
  let n = 0;
  for (let i = tokEvents.length - 1; i >= 0 && tokEvents[i].t >= cutoff; i--) n += tokEvents[i].n;
  return n;
}

export function acquire(consumer: LlmConsumer, estTokens: number): boolean {
  const now = Date.now();
  if (now < parkedUntil) return false;
  rollDay();
  prune(now);
  if (reqsWithin(now, 60_000) + 1 > limits.rpm) return false;
  if (reqsWithin(now, 3_600_000) + 1 > limits.rph) return false;
  if (reqsWithin(now, 86_400_000) + 1 > limits.rpd) return false;
  if (toksWithin(now, 60_000) + estTokens > limits.tpm) return false;
  if (toksWithin(now, 3_600_000) + estTokens > limits.tph) return false;
  if (toksWithin(now, 86_400_000) + estTokens > limits.tpd) return false;
  if (dailySpent[consumer] + estTokens > daily_token_budget[consumer]) return false;
  reqTimes.push(now);
  tokEvents.push({ t: now, n: estTokens });
  dailySpent[consumer] += estTokens;
  return true;
}

export function record(consumer: LlmConsumer, estTokens: number, actualTokens: number): void {
  const delta = actualTokens - estTokens;
  if (delta !== 0) {
    tokEvents.push({ t: Date.now(), n: delta });
    dailySpent[consumer] += delta;
  }
}

export function note429(retryAfterMs: number): void {
  parkedUntil = Math.max(parkedUntil, Date.now() + Math.max(1000, retryAfterMs));
}

export function budgetSnapshot(): {
  parked: boolean;
  spent: Record<LlmConsumer, number>;
  reqLastMin: number;
} {
  const now = Date.now();
  prune(now);
  return {
    parked: now < parkedUntil,
    spent: { ...dailySpent },
    reqLastMin: reqsWithin(now, 60_000),
  };
}

type CreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

export async function callLLM(
  consumer: LlmConsumer,
  params: Omit<CreateParams, "model">,
  estTokens: number,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (!client) throw new BudgetExceeded(consumer);
  if (!acquire(consumer, estTokens)) throw new BudgetExceeded(consumer);
  const body = {
    model,
    max_completion_tokens,
    reasoning_effort,
    ...params,
  } as unknown as CreateParams;
  try {
    const res = await client.chat.completions.create(body);
    record(consumer, estTokens, res.usage?.total_tokens ?? estTokens);
    return res;
  } catch (err) {
    record(consumer, estTokens, 0);
    const e = err as { status?: number; headers?: Record<string, string> };
    if (e?.status === 429) {
      const ra = Number(e.headers?.["retry-after"]) * 1000;
      note429(Number.isFinite(ra) && ra > 0 ? ra : 60_000);
    }
    throw err;
  }
}
