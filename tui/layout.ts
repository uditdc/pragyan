import type { FeedCard } from "./threads.ts";
import { wrapText } from "./format.ts";

export function bodyWidth(paneWidth: number): number {
  return Math.max(10, paneWidth - 4);
}

export function itemHeight(card: FeedCard, paneWidth: number): number {
  const wrapped = wrapText(card.lead.text, bodyWidth(paneWidth)).length;
  return 1 + Math.min(2, Math.max(1, wrapped));
}

export interface Window {
  start: number;
  count: number;
  hasAbove: boolean;
  hasBelow: boolean;
}

export function pickWindow(
  cards: FeedCard[],
  selected: number,
  prevStart: number,
  rows: number,
  paneWidth: number,
): Window {
  if (cards.length === 0) {
    return { start: 0, count: 0, hasAbove: false, hasBelow: false };
  }
  const h = cards.map((c) => itemHeight(c, paneWidth));
  let start = Math.max(0, Math.min(prevStart, selected));

  for (;;) {
    let used = 0;
    for (let i = start; i <= selected; i++) used += h[i];
    if (used <= rows || start >= selected) break;
    start++;
  }

  let used = 0;
  let count = 0;
  for (let i = start; i < cards.length; i++) {
    if (used + h[i] > rows && count > 0) break;
    used += h[i];
    count++;
  }

  return {
    start,
    count,
    hasAbove: start > 0,
    hasBelow: start + count < cards.length,
  };
}
