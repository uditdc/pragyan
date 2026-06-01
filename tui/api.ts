import type { Post } from "../shared/post.ts";

export interface FeedResponse {
  posts: Post[];
  next_since: string | null;
}

export interface FeedParams {
  baseUrl: string;
  minScore: number;
  newsOnly: boolean;
  limit: number;
}

export async function fetchHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchFeed(params: FeedParams): Promise<FeedResponse> {
  const url = new URL(`${params.baseUrl}/feed`);
  url.searchParams.set("min_score", String(params.minScore));
  url.searchParams.set("limit", String(params.limit));
  if (params.newsOnly) url.searchParams.set("news_only", "true");

  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return (await res.json()) as FeedResponse;
}
