import type { Post } from "../shared/post.ts";
import { searchPosts, type PostSearchQuery } from "./db.ts";

interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Feed/digest search tools, backed directly by the SQLite store. Exposed as a
// reusable layer for an MCP server (or any tool-calling client).
function projectPost(p: Post) {
  return {
    id: p.id,
    author_handle: p.author_handle,
    author_name: p.author_name,
    text: p.text.slice(0, 280),
    url: p.url,
    created_at: p.created_at,
    is_news: p.source === "google_news" || Boolean(p.scores?.is_news),
    likes: p.metrics.likes,
    reposts: p.metrics.reposts,
  };
}

export const TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "search_feed",
      description:
        "Search the reader's feed posts by keyword and/or author. Returns matching posts, most recent first.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword(s) to match in post text or author." },
          author: { type: "string", description: "Filter to a specific handle or author name." },
          news_only: { type: "boolean", description: "Only return news-classified posts." },
          since_hours: { type: "number", description: "Only posts from the last N hours." },
          min_score: { type: "number", description: "Minimum composite relevance score (0-1)." },
          limit: { type: "number", description: "Max results (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_feed",
      description: "Get the most recent feed posts without keyword filtering. Use for 'what's new'.",
      parameters: {
        type: "object",
        properties: {
          news_only: { type: "boolean", description: "Only return news-classified posts." },
          limit: { type: "number", description: "Max results (default 20)." },
        },
      },
    },
  },
];

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function sinceFrom(hours: unknown): string | null {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

export function runTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "search_feed": {
      const q: PostSearchQuery = {
        text: typeof args.query === "string" ? args.query : null,
        author: typeof args.author === "string" ? args.author : null,
        news_only: Boolean(args.news_only),
        since: sinceFrom(args.since_hours),
        min_score: Number(args.min_score) || 0,
        limit: clampLimit(args.limit, 20, 20),
        include_expired: false,
      };
      return searchPosts(q).map(projectPost);
    }
    case "recent_feed":
      return searchPosts({
        text: null,
        author: null,
        news_only: Boolean(args.news_only),
        since: null,
        min_score: 0,
        limit: clampLimit(args.limit, 20, 20),
        include_expired: false,
      }).map(projectPost);
    default:
      return { error: `unknown tool: ${name}` };
  }
}
