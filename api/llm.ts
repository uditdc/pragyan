import OpenAI from "openai";
import { config } from "./config.ts";

const baseURL = process.env.XFEED_LLM_BASE_URL;
const apiKey = process.env.XFEED_LLM_API_KEY;

export const llmEnabled = Boolean(baseURL && apiKey);
export const model = process.env.XFEED_LLM_MODEL ?? config.scoring.model;

export const client = llmEnabled ? new OpenAI({ baseURL, apiKey }) : null;
