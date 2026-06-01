import type { Post } from "../shared/post.ts";
import type {
  SummariesResponse,
  SummaryRecord,
  SummaryResponse,
} from "../shared/summary.ts";

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

async function postIds(baseUrl: string, path: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(5000),
  });
}

export const postViewed = (baseUrl: string, ids: string[]) =>
  postIds(baseUrl, "/viewed", ids);
export const postDismiss = (baseUrl: string, ids: string[]) =>
  postIds(baseUrl, "/dismiss", ids);
export const postUndismiss = (baseUrl: string, ids: string[]) =>
  postIds(baseUrl, "/undismiss", ids);

export async function fetchSummary(baseUrl: string): Promise<SummaryResponse> {
  const res = await fetch(`${baseUrl}/summary`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  return (await res.json()) as SummaryResponse;
}

export async function fetchSummaries(baseUrl: string): Promise<SummariesResponse> {
  const res = await fetch(`${baseUrl}/summaries`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`summaries ${res.status}`);
  return (await res.json()) as SummariesResponse;
}

export async function regenerateSummary(baseUrl: string): Promise<SummaryRecord | null> {
  const res = await fetch(`${baseUrl}/summary/regenerate`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`regenerate ${res.status}`);
  return (await res.json()) as SummaryRecord | null;
}
