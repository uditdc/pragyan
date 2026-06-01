export const SCHEMA_VERSION = 1 as const;

export type MediaType = "photo" | "video" | "gif" | "card";

export interface Metrics {
  replies: number;
  reposts: number;
  likes: number;
  views: number;
}

export interface Scores {
  relevance: number;
  importance: number;
  clickbait: number;
  is_news: boolean;
  news_confidence: number;
}

export type DropReason =
  | "ad"
  | "pure_reply"
  | "below_engagement_floor"
  | "no_substance";

export interface Post {
  schema_version: number;
  id: string;
  author_handle: string;
  author_name: string;
  text: string;
  created_at: string;
  url: string;

  is_repost: boolean;
  is_quote: boolean;
  is_reply: boolean;
  is_ad: boolean;
  is_thread: boolean;
  thread_id: string | null;

  quoted_text: string | null;
  media_types: MediaType[];

  metrics: Metrics;
  harvested_at: string;

  kept: boolean;
  drop_reason: DropReason | null;
  clickbait_heuristic: number;

  scores: Scores | null;
  scored_at: string | null;

  viewed_at: string | null;
  expired_at: string | null;
}

export type HarvestedPost = Pick<
  Post,
  | "id"
  | "author_handle"
  | "author_name"
  | "text"
  | "created_at"
  | "url"
  | "is_repost"
  | "is_quote"
  | "is_reply"
  | "is_ad"
  | "is_thread"
  | "thread_id"
  | "quoted_text"
  | "media_types"
  | "metrics"
  | "harvested_at"
>;

export interface IngestResult {
  received: number;
  new: number;
  duplicate: number;
  flagged_dropped: number;
}
