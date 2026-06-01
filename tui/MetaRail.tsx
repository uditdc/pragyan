import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type { SummaryRecord } from "../shared/summary.ts";
import { P } from "./theme.ts";
import { fmtClock, relativeTime } from "./format.ts";
import { MetaBar } from "./MetaBar.tsx";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={P.faint}>{title}</Text>
      {children}
    </Box>
  );
}

export function MetaRail({
  summary,
  width,
  height,
  now,
}: {
  summary: SummaryRecord;
  width: number;
  height: number;
  now: number;
}) {
  const inner = Math.max(12, width - 3);
  const { source_counts: sc, item_count, digest } = summary;
  const max = Math.max(1, item_count);
  const volBarW = Math.max(4, inner - 12);

  const sent = digest.sentiment;
  const sentTotal = Math.max(1, sent.pos + sent.neu + sent.neg);
  const sentBarW = Math.max(6, inner);
  const pos = Math.round((sent.pos / sentTotal) * sentBarW);
  const neg = Math.round((sent.neg / sentTotal) * sentBarW);
  const neu = Math.max(0, sentBarW - pos - neg);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={P.rule}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingX={1}
      overflow="hidden"
    >
      <Section title="GENERATED">
        <Text color={P.dim}>
          {relativeTime(summary.generated_at, now)} ago
          {summary.gen_ms != null ? ` · ${(summary.gen_ms / 1000).toFixed(1)}s` : ""}
        </Text>
        <Text color={P.faint}>
          {fmtClock(Date.parse(summary.window_start))}–{fmtClock(Date.parse(summary.window_end))}
        </Text>
      </Section>

      <Section title={`VOLUME — ${item_count} items`}>
        <MetaBar label="X" color={P.x} frac={sc.x / max} value={String(sc.x)} width={volBarW} />
        <MetaBar label="news" color={P.news} frac={sc.news / max} value={String(sc.news)} width={volBarW} />
      </Section>

      <Section title="SENTIMENT">
        <Text wrap="truncate">
          <Text color={P.up}>{"█".repeat(pos)}</Text>
          <Text color={P.faint}>{"█".repeat(neu)}</Text>
          <Text color={P.down}>{"█".repeat(neg)}</Text>
        </Text>
        <Box>
          <Text color={P.up}>pos {sent.pos}</Text>
          <Box flexGrow={1} />
          <Text color={P.faint}>neu {sent.neu}</Text>
          <Box flexGrow={1} />
          <Text color={P.down}>neg {sent.neg}</Text>
        </Box>
      </Section>

      {digest.top_voices.length > 0 && (
        <Section title="TOP VOICES">
          {digest.top_voices.map((v, i) => (
            <Text key={i} wrap="truncate">
              <Text color={v.source === "news" ? P.news : P.x}>● </Text>
              <Text color={P.dim}>{v.handle} </Text>
              <Text color={P.faint}>{v.note}</Text>
            </Text>
          ))}
        </Section>
      )}

      <Box flexGrow={1} />
      <Text color={P.faint} wrap="wrap">
        synthesized · llm · cites every claim. read-only.
      </Text>
    </Box>
  );
}
