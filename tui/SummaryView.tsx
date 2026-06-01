import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type { SummaryRecord } from "../shared/summary.ts";
import { P } from "./theme.ts";
import { fmtClock } from "./format.ts";
import { DigestColumn } from "./DigestColumn.tsx";
import { MetaRail } from "./MetaRail.tsx";

function sourcesCount(summary: SummaryRecord): number {
  return [
    summary.source_counts.x > 0,
    summary.source_counts.news > 0,
    summary.digest.movers.length > 0,
  ].filter(Boolean).length;
}

export function SummaryView({
  summary,
  newSince,
  index,
  total,
  regenerating,
  width,
  height,
  now,
}: {
  summary: SummaryRecord | null;
  newSince: number;
  index: number;
  total: number;
  regenerating: boolean;
  width: number;
  height: number;
  now: number;
}) {
  const railWidth = width >= 80 ? 26 : 0;
  const colWidth = width - railWidth;
  const viewingOlder = index > 0;

  const banner = regenerating ? (
    <Text color={P.accent}>✦ writing digest …</Text>
  ) : viewingOlder ? (
    <Text color={P.faint}>◂ older digest {index + 1}/{total} — → newer · ← older</Text>
  ) : newSince > 0 ? (
    <Text color={P.news}>⟳ {newSince} new items since this digest — press r to regenerate</Text>
  ) : (
    <Text> </Text>
  );

  let body: ReactNode;
  if (!summary) {
    body = (
      <Box paddingX={1}>
        <Text color={P.faint}>
          {regenerating ? "writing first digest …" : "no digest yet — press r to generate"}
        </Text>
      </Box>
    );
  } else if (summary.status === "empty") {
    body = (
      <Box paddingX={1}>
        <Text color={P.faint}>
          ◦ quiet window — {summary.item_count} items, nothing rose above the noise floor.
        </Text>
      </Box>
    );
  } else {
    body = (
      <Box width={width} flexGrow={1} overflow="hidden">
        <DigestColumn digest={summary.digest} width={colWidth} />
        {railWidth > 0 && (
          <MetaRail summary={summary} width={railWidth} height={height - 2} now={now} />
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Box height={1} paddingX={1}>
        <Text color={P.white} bold>
          DIGEST
        </Text>
        {total > 1 && (
          <Text color={viewingOlder ? P.news : P.faint}>
            {" "}
            {index + 1}/{total}
          </Text>
        )}
        {summary && (
          <Text color={P.faint}>
            {"   "}
            {fmtClock(Date.parse(summary.window_start))} – {fmtClock(Date.parse(summary.window_end))}
          </Text>
        )}
        <Box flexGrow={1} />
        {summary && (
          <Text color={P.faint}>
            {summary.item_count} items · {sourcesCount(summary)} sources
          </Text>
        )}
      </Box>
      <Box height={1} paddingX={1}>
        {banner}
      </Box>
      {body}
    </Box>
  );
}
