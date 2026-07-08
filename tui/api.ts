import type { FeedSort, Post } from "../shared/post.ts";
import type { ReportsResponse } from "../shared/report.ts";
import type { Insight } from "../shared/kb.ts";

export interface FeedResponse {
  posts: Post[];
  next_since: string | null;
}

export interface FeedParams {
  baseUrl: string;
  minScore: number;
  newsOnly: boolean;
  limit: number;
  sort: FeedSort;
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
  url.searchParams.set("sort", params.sort);
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

export async function fetchReports(baseUrl: string): Promise<ReportsResponse> {
  const res = await fetch(`${baseUrl}/reports`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`reports ${res.status}`);
  return (await res.json()) as ReportsResponse;
}

export async function fetchInsights(baseUrl: string): Promise<Insight[]> {
  const res = await fetch(`${baseUrl}/insights`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`insights ${res.status}`);
  return ((await res.json()) as { insights: Insight[] }).insights;
}

export async function approveInsight(baseUrl: string, id: string): Promise<void> {
  await fetch(`${baseUrl}/insights/${id}/approve`, { method: "POST", signal: AbortSignal.timeout(5000) });
}

export async function rejectInsight(baseUrl: string, id: string): Promise<void> {
  await fetch(`${baseUrl}/insights/${id}/reject`, { method: "POST", signal: AbortSignal.timeout(5000) });
}
