import type { HarvestedPost, Scores } from "../shared/post.ts";

export function dummyScore(post: HarvestedPost, clickbait: number): Scores {
  const { likes, reposts } = post.metrics;
  const reach = Math.log10(1 + likes + reposts);
  const importance = Math.min(1, reach / 5);
  const relevance = Math.min(1, 0.3 + reach / 8);
  const is_news = post.source === "google_news";
  return {
    relevance,
    importance,
    clickbait,
    is_news,
    news_confidence: is_news ? 1 : 0,
  };
}
