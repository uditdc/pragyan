import { Box, Text } from "ink";
import type { FeedCard } from "./threads.ts";
import { P, sourceOf, sourceColor, sigil } from "./theme.ts";
import { relativeTime, fmtCount } from "./format.ts";
import { Panel } from "./Panel.tsx";

interface Props {
  card: FeedCard | null;
  width: number;
  now: number;
}

export function DetailPane({ card, width, now }: Props) {
  const inner = Math.max(8, width - 4);

  if (!card) {
    return (
      <Panel title="DETAIL" width={width}>
        <Text color={P.faint}>no selection</Text>
      </Panel>
    );
  }

  const post = card.lead;
  const source = sourceOf(post);
  const s = post.scores;
  const priority = (s?.importance ?? 0) >= 0.7;
  const m = post.metrics;
  const rest = card.parts.slice(1);

  return (
    <Panel
      icon={sigil(source)}
      iconColor={sourceColor(source)}
      title="DETAIL"
      meta="↵ open"
      width={width}
    >
      <Box>
        <Text wrap="truncate">
          <Text color={P.white} bold>
            {post.author_name}
          </Text>
          {priority ? <Text color={P.news}> ▲ alert</Text> : null}
        </Text>
      </Box>
      <Text color={P.faint} wrap="truncate">
        {post.author_handle} · {relativeTime(post.created_at, now)} ago · via X
      </Text>

      <Box marginTop={1}>
        <Text color={P.fg}>{post.text}</Text>
      </Box>
      {rest.map((part) => (
        <Box key={part.id} marginTop={1} paddingLeft={1}>
          <Text color={P.faint}>↳ </Text>
          <Text color={P.dim}>{part.text}</Text>
        </Box>
      ))}

      <Box marginY={1}>
        <Text color={P.rule}>{"─".repeat(inner)}</Text>
      </Box>

      <Text wrap="truncate">
        <Text color={P.dim}>♥ </Text>
        <Text color={P.fg}>{fmtCount(m.likes)}</Text>
        <Text color={P.dim}>{"   "}⇄ </Text>
        <Text color={P.fg}>{fmtCount(m.reposts)}</Text>
        <Text color={P.dim}>{"   "}↗ </Text>
        <Text color={P.fg}>{fmtCount(m.views)}</Text>
      </Text>

      <Box marginTop={1} flexDirection="column">
        {s ? (
          <>
            <Text color={P.faint}>
              relevance {s.relevance.toFixed(2)} · importance {s.importance.toFixed(2)}
            </Text>
            <Text color={P.faint}>
              clickbait {s.clickbait.toFixed(2)} · news {s.news_confidence.toFixed(2)}
            </Text>
            <Text color={P.faint}>is_news {s.is_news ? "yes" : "no"}</Text>
          </>
        ) : (
          <Text color={P.faint}>unscored</Text>
        )}
        <Text color={P.faint} wrap="truncate">
          link {post.url}
        </Text>
      </Box>

      <Box flexGrow={1} />
      <Text color={P.faint}>read-only — no reply / like / repost</Text>
    </Panel>
  );
}
