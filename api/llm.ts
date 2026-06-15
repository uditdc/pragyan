import OpenAI from "openai";
import { config } from "./config.ts";

function makeClient(baseURL?: string, apiKey?: string): OpenAI | null {
  return baseURL && apiKey ? new OpenAI({ baseURL, apiKey }) : null;
}

// Summary digest (and, later, ranking) — the default LLM.
const summaryBaseURL = process.env.XFEED_LLM_BASE_URL;
const summaryApiKey = process.env.XFEED_LLM_API_KEY;

export const llmEnabled = Boolean(summaryBaseURL && summaryApiKey);
export const model = process.env.XFEED_LLM_MODEL ?? config.scoring.model;
export const client = makeClient(summaryBaseURL, summaryApiKey);

// Chat assistant — its own endpoint/model, falling back to the summary LLM when
// the chat-specific vars are unset.
const chatBaseURL = process.env.XFEED_CHAT_BASE_URL ?? summaryBaseURL;
const chatApiKey = process.env.XFEED_CHAT_API_KEY ?? summaryApiKey;

export const chatEnabled = Boolean(chatBaseURL && chatApiKey);
export const chatModel = process.env.XFEED_CHAT_MODEL ?? model;
export const chatClient = makeClient(chatBaseURL, chatApiKey);
