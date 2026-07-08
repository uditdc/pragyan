import { Box, Text } from "ink";
import type { Insight, InsightStatus } from "../shared/kb.ts";
import { P } from "./theme.ts";
import { Panel } from "./Panel.tsx";
import { relativeAgo } from "./format.ts";

function statusColor(s: InsightStatus): string {
  return s === "approved"
    ? P.up
    : s === "rejected"
      ? P.down
      : s === "acted"
        ? P.accent
        : P.news;
}

export function InsightsView({
  insights,
  selectedIdx,
  width,
  height,
  now,
}: {
  insights: Insight[];
  selectedIdx: number;
  width: number;
  height: number;
  now: number;
}) {
  const rows = Math.max(1, height - 4);
  const start = Math.max(
    0,
    Math.min(selectedIdx - Math.floor(rows / 2), Math.max(0, insights.length - rows)),
  );
  const visible = insights.slice(start, start + rows);
  const pending = insights.filter((i) => i.status === "pending").length;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel
        title="INSIGHTS"
        meta={`${insights.length} · ${pending} pending · ↵ read · a approve · x reject`}
        width={width - 2}
        flexGrow={1}
      >
        {insights.length === 0 ? (
          <Text color={P.faint}>no insights yet — Claude proposes, you approve.</Text>
        ) : (
          visible.map((ins, vi) => {
            const idx = start + vi;
            const selected = idx === selectedIdx;
            return (
              <Box key={ins.id} flexDirection="column">
                <Box>
                  <Text color={selected ? P.accent : P.faint}>{selected ? "▸ " : "  "}</Text>
                  <Text color={statusColor(ins.status)}>{ins.status.toUpperCase().padEnd(9)}</Text>
                  {ins.updated_at && <Text color={P.news}>{"↻ "}</Text>}
                  <Text color={selected ? P.white : P.fg} bold wrap="truncate">
                    {ins.title}
                  </Text>
                </Box>
                {selected && (
                  <Box flexDirection="column" paddingLeft={4}>
                    <Text color={P.dim} wrap="truncate">
                      {ins.body}
                    </Text>
                    <Text color={P.faint} wrap="truncate">
                      {ins.updated_at ? `↻ revised ${relativeAgo(ins.updated_at, now)} · ` : ""}
                      {ins.rationale ? `why: ${ins.rationale} · ` : ""}
                      {ins.source_refs.length} source(s)
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Panel>
    </Box>
  );
}
