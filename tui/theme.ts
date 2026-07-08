import type { Post } from "../shared/post.ts";

export const P = {
  bg: "#16171c",
  panel: "#1c1e25",
  rule: "#2b2e38",
  faint: "#565b67",
  dim: "#969cab",
  fg: "#d7dae2",
  white: "#eef0f5",
  accent: "#5cb6ac",
  x: "#6f9bd1",
  news: "#c7a36a",
  up: "#74b58a",
  down: "#d08176",
  log: "#9089bd",
  matrixHead: "#335343ff",
  matrixBody: "#2c4536",
  matrixTrail: "#1e2b23",
} as const;

export type Source = "x" | "news";

export function sourceOf(post: Post): Source {
  return post.source === "google_news" || post.scores?.is_news ? "news" : "x";
}

export function sourceColor(source: Source): string {
  return source === "news" ? P.news : P.x;
}

export function sigil(source: Source): string {
  return source === "news" ? "*" : "X";
}

export function marketColor(up: boolean): string {
  return up ? P.up : P.down;
}
