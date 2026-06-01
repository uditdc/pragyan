import type { Post } from "../shared/post.ts";

export interface FeedCard {
  key: string;
  lead: Post;
  parts: Post[];
}

function threadGroupId(post: Post): string | null {
  if (post.thread_id) return `tid:${post.thread_id}`;
  if (post.is_thread) return `auth:${post.author_handle}`;
  return null;
}

export function consolidateThreads(posts: Post[]): FeedCard[] {
  const cards: FeedCard[] = [];
  const byGroup = new Map<string, FeedCard>();

  for (const post of posts) {
    const group = threadGroupId(post);
    if (group === null) {
      cards.push({ key: post.id, lead: post, parts: [post] });
      continue;
    }

    const existing = byGroup.get(group);
    if (existing) {
      existing.parts.push(post);
    } else {
      const card: FeedCard = { key: post.id, lead: post, parts: [post] };
      byGroup.set(group, card);
      cards.push(card);
    }
  }

  for (const card of cards) {
    card.parts.sort((a, b) => a.created_at.localeCompare(b.created_at));
    card.lead = card.parts[0];
  }

  return cards;
}
