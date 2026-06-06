import type { DropReason, HarvestedPost } from "../shared/post.ts";
import { config } from "./config.ts";

export interface PrefilterVerdict {
  kept: boolean;
  drop_reason: DropReason | null;
  clickbait_heuristic: number;
}

const EMOJI = /\p{Extended_Pictographic}/gu;

function capsRatio(text: string): number {
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length;
}

function emojiDensity(text: string): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  return (text.match(EMOJI)?.length ?? 0) / chars.length;
}

export function clickbaitScore(text: string): number {
  const lower = text.toLowerCase();
  const phraseHits = config.prefilter.clickbait_phrases.filter((p) =>
    lower.includes(p.toLowerCase()),
  ).length;

  const phraseSignal = Math.min(1, phraseHits * 0.34);
  const capsSignal = Math.max(0, capsRatio(text) - 0.3) / 0.7;
  const emojiSignal = Math.min(1, emojiDensity(text) * 8);

  return Math.min(1, 0.6 * phraseSignal + 0.25 * capsSignal + 0.15 * emojiSignal);
}

export function prefilter(post: HarvestedPost): PrefilterVerdict {
  const clickbait_heuristic = clickbaitScore(post.text);
  const drop = (reason: DropReason): PrefilterVerdict => ({
    kept: false,
    drop_reason: reason,
    clickbait_heuristic,
  });

  if (post.is_ad) return drop("ad");
  if (post.is_reply && config.prefilter.drop_replies) return drop("pure_reply");

  const engagement = post.metrics.likes + post.metrics.reposts;
  if (engagement < config.prefilter.engagement_floor) {
    return drop("below_engagement_floor");
  }

  if (post.text.trim().length < config.prefilter.min_text_len) {
    return drop("no_substance");
  }

  return { kept: true, drop_reason: null, clickbait_heuristic };
}
