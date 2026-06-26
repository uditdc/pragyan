import { Box, Text } from "ink";
import { P } from "./theme.ts";
import { Panel } from "./Panel.tsx";
import { wrapText, clampLines } from "./format.ts";

export function KbReader({
  kind,
  meta,
  headline,
  lead,
  leadColor,
  body,
  provenance,
  scroll,
  width,
  height,
}: {
  kind: string;
  meta?: string;
  headline: string;
  lead?: string;
  leadColor?: string;
  body: string;
  provenance: string[];
  scroll: number;
  width: number;
  height: number;
}) {
  const inner = Math.max(8, width - 6);
  const leadLines = lead ? clampLines(lead, inner - 2, 2) : [];
  const provShown = provenance.slice(0, 4);
  const provBlock = provShown.length ? provShown.length + 1 : 0;
  const content = Math.max(3, height - 4);
  const viewport = Math.max(1, content - 1 - 1 - leadLines.length - provBlock - 1);

  const lines = wrapText(body, inner);
  const maxScroll = Math.max(0, lines.length - viewport);
  const top = Math.min(scroll, maxScroll);
  const shown = lines.slice(top, top + viewport);
  const below = lines.length - (top + viewport);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel title={kind} meta={meta} width={width - 2} flexGrow={1} focus>
        <Text color={P.white} bold wrap="truncate">
          {headline}
        </Text>
        {leadLines.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            {leadLines.map((ln, i) => (
              <Text key={i} color={leadColor ?? P.accent} wrap="truncate">
                {i === 0 ? "◆ " : "  "}
                {ln}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column" height={viewport} overflow="hidden" marginTop={1}>
          {shown.map((ln, i) => (
            <Text key={top + i} color={P.fg} wrap="truncate">
              {ln || " "}
            </Text>
          ))}
        </Box>
        {provShown.length > 0 && (
          <Box flexDirection="column">
            <Text color={P.faint}>sources</Text>
            {provShown.map((s, i) => (
              <Text key={i} color={P.dim} wrap="truncate">
                · {s}
              </Text>
            ))}
          </Box>
        )}
        <Box flexGrow={1} />
        <Text color={P.faint} wrap="truncate">
          {top > 0 ? "↑ more · " : ""}
          {below > 0 ? `${below} more ↓ · ` : ""}j/k scroll · esc close
        </Text>
      </Panel>
    </Box>
  );
}
