import type { FeedSort, Post } from "../shared/post.ts";
import type {
  SummariesResponse,
  SummaryRecord,
  SummaryResponse,
} from "../shared/summary.ts";
import type { ChatEvent, ChatMessage, ChatResponse } from "../shared/chat.ts";

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

export async function postChat(
  baseUrl: string,
  messages: ChatMessage[],
  onEvent?: (ev: ChatEvent) => void,
): Promise<ChatResponse> {
  const res = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);

  const decoder = new TextDecoder();
  let buf = "";
  let final: ChatResponse | null = null;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { type: string } & Record<string, unknown>;
      if (msg.type === "event") onEvent?.({ kind: msg.kind as ChatEvent["kind"], label: String(msg.label) });
      else if (msg.type === "result") final = msg as unknown as ChatResponse;
    }
  }
  if (!final) throw new Error("chat: no result");
  return final;
}
