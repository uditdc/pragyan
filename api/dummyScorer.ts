import type { HarvestedPost, Scores } from "../shared/post.ts";

export function dummyScore(post: HarvestedPost, clickbait: number): Scores {
  const { likes, reposts, views } = post.metrics;
  const reach = Math.log10(1 + likes + reposts);
  const importance = Math.min(1, reach / 5);
  const relevance = Math.min(1, 0.3 + reach / 8);
  const newsRatio = views > 0 ? (likes + reposts) / views : 0;

  return {
    relevance,
    importance,
    clickbait,
    is_news: newsRatio > 0.005 && !post.is_repost,
    news_confidence: Math.min(1, newsRatio * 50),
  };
}
