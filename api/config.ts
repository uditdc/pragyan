import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export interface Config {
  interest_topics: string[];
  weights: { importance: number; relevance: number; clickbait: number };
  gates: { min_news_confidence: number; news_only_default: boolean };
  feed: { max_age_hours: number };
  llm: {
    timeout_ms: number;
    max_retries: number;
    max_completion_tokens: number;
    reasoning_effort: string;
    limits: { rpm: number; rph: number; rpd: number; tpm: number; tph: number; tpd: number };
    daily_token_budget: { scorer: number; summary: number };
  };
  prefilter: {
    engagement_floor: number;
    drop_replies: boolean;
    min_text_len: number;
    clickbait_phrases: string[];
  };
  scoring: {
    model: string;
    batch_size: number;
    max_concurrent_batches: number;
    poll_interval_ms: number;
    engagement_floor_for_llm: number;
  };
  expiry: {
    mark_viewed_on: string;
    viewed_ttl_min: number;
    unviewed_ttl_hours: number;
  };
  summary: {
    max_posts: number;
    min_items: number;
    retention: number;
  };
  sources: {
    provider: "mock" | "real";
    poll_interval_ms: number;
    crypto_count: number;
    polymarket_count: number;
    news: {
      enabled: boolean;
      poll_interval_ms: number;
      per_topic_cap: number;
      hl: string;
      gl: string;
      ceid: string;
    };
  };
  monitors: {
    interval_ms: number;
    timeout_ms: number;
    history: number;
    services: { name: string; url: string }[];
  };
  maintenance: { drop_retention_days: number; interval_ms: number };
  server: { host: string; port: number; db_path: string };
}

export const config: Config = JSON.parse(
  readFileSync(join(here, "config.json"), "utf8"),
);

export function validateConfig(c: Config): void {
  const finite = (n: unknown, path: string): void => {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error(`config: ${path} must be a finite number (got ${JSON.stringify(n)})`);
    }
  };
  if (!Array.isArray(c.interest_topics) || c.interest_topics.length === 0) {
    throw new Error("config: interest_topics must be a non-empty array");
  }
  for (const k of ["importance", "relevance", "clickbait"] as const) finite(c.weights[k], `weights.${k}`);
  finite(c.feed.max_age_hours, "feed.max_age_hours");
  for (const k of ["rpm", "rph", "rpd", "tpm", "tph", "tpd"] as const) finite(c.llm.limits[k], `llm.limits.${k}`);
  finite(c.scoring.batch_size, "scoring.batch_size");
  finite(c.scoring.poll_interval_ms, "scoring.poll_interval_ms");
  finite(c.maintenance.drop_retention_days, "maintenance.drop_retention_days");
}

validateConfig(config);
