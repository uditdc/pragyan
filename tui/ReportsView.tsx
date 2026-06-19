import { Box, Text } from "ink";
import type { Report } from "../shared/kb.ts";
import { P } from "./theme.ts";
import { Panel } from "./Panel.tsx";
import { fmtClock } from "./format.ts";

export function ReportsView({
  reports,
  width,
  height,
}: {
  reports: Report[];
  width: number;
  height: number;
}) {
  const rows = Math.max(1, Math.floor((height - 4) / 3));

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel title="REPORTS" meta={`${reports.length} · Claude's analyses`} width={width - 2} flexGrow={1}>
        {reports.length === 0 ? (
          <Text color={P.faint}>no reports yet — Claude writes these from its research loop.</Text>
        ) : (
          reports.slice(0, rows).map((r) => (
            <Box key={r.id} flexDirection="column">
              <Box>
                <Text color={P.faint}>{fmtClock(Date.parse(r.created_at) || Date.now())} </Text>
                <Text color={P.white} bold wrap="truncate">
                  {r.title}
                </Text>
              </Box>
              <Box paddingLeft={2} flexDirection="column">
                {r.opinion ? (
                  <Text color={P.accent} wrap="truncate">
                    ◆ {r.opinion}
                  </Text>
                ) : null}
                <Text color={P.faint} wrap="truncate">
                  {r.citations.length} citation(s){r.model ? ` · ${r.model}` : ""}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Panel>
    </Box>
  );
}
