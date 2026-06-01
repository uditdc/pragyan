import { Box, Text } from "ink";
import type { FeedCard } from "./threads.ts";
import { P, sourceOf, sourceColor, sigil } from "./theme.ts";
import { relativeTime, metricsLine, clampLines } from "./format.ts";
import { bodyWidth } from "./layout.ts";

interface Props {
  card: FeedCard;
  width: number;
  selected: boolean;
  fresh: boolean;
  now: number;
}

export function FeedItem({ card, width, selected, fresh, now }: Props) {
  const post = card.lead;
  const source = sourceOf(post);
  const gutter = selected ? P.accent : sourceColor(source);
  const nameColor = selected ? P.white : P.fg;
  const bodyColor = selected ? P.fg : P.dim;
  const priority = (post.scores?.importance ?? 0) >= 0.7;
  const threadTag = card.parts.length > 1 ? ` · thread ×${card.parts.length}` : "";
  const lines = clampLines(post.text, bodyWidth(width), 2);

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={gutter}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate">
            {fresh ? <Text color={P.accent}>• </Text> : null}
            <Text color={sourceColor(source)}>{sigil(source)} </Text>
            <Text color={nameColor} bold={selected}>
              {post.author_name}{" "}
            </Text>
            {priority ? <Text color={P.news}>▲ </Text> : null}
            <Text color={P.faint}>
              {post.author_handle} · {relativeTime(post.created_at, now)}
              {threadTag}
            </Text>
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text color={P.faint}>{metricsLine(post.metrics)}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2}>
        <Text color={bodyColor}>{lines.join("\n")}</Text>
      </Box>
    </Box>
  );
}
