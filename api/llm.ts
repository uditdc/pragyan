import OpenAI from "openai";
import { config } from "./config.ts";

function makeClient(baseURL?: string, apiKey?: string): OpenAI | null {
  return baseURL && apiKey
    ? new OpenAI({
        baseURL,
        apiKey,
        timeout: config.llm.timeout_ms,
        maxRetries: config.llm.max_retries,
      })
    : null;
}

// Summary digest (and, later, ranking) — the default LLM.
const summaryBaseURL = process.env.XFEED_LLM_BASE_URL;
const summaryApiKey = process.env.XFEED_LLM_API_KEY;

export const llmEnabled = Boolean(summaryBaseURL && summaryApiKey);
export const model = process.env.XFEED_LLM_MODEL ?? config.scoring.model;
export const client = makeClient(summaryBaseURL, summaryApiKey);
