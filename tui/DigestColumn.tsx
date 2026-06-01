import { Box, Text } from "ink";
import type { Digest } from "../shared/summary.ts";
import { P } from "./theme.ts";
import { fmtPrice } from "./format.ts";
import { Cite } from "./Cite.tsx";

const KICKER_COLOR: Record<string, string> = {
  MACRO: P.news,
  MARKET: P.news,
  INCIDENT: P.down,
  ALERT: P.down,
  DEV: P.x,
  TECH: P.x,
};

function kickerColor(kicker: string): string {
  return KICKER_COLOR[kicker] ?? P.faint;
}

const accentRail = {
  borderStyle: "single" as const,
  borderColor: P.accent,
  borderTop: false,
  borderRight: false,
  borderBottom: false,
  paddingLeft: 1,
};

export function DigestColumn({ digest, width }: { digest: Digest; width: number }) {
  return (
    <Box flexDirection="column" width={width} paddingX={1} overflow="hidden">
      <Box flexDirection="column" {...accentRail}>
        <Text color={P.accent}>TL;DR</Text>
        <Text color={P.fg} wrap="wrap">
          {digest.tldr}
        </Text>
      </Box>

      {digest.themes.map((t, i) => (
        <Box key={i} flexDirection="column" marginTop={1} paddingLeft={1}>
          <Text wrap="truncate">
            <Text color={kickerColor(t.kicker)} bold>
              {t.kicker}{" "}
            </Text>
            <Text color={P.fg} bold>
              {t.title}
            </Text>
          </Text>
          <Text color={P.dim} wrap="wrap">
            {t.body}
          </Text>
          {t.citations.length > 0 && (
            <Box flexWrap="wrap">
              {t.citations.map((c, j) => (
                <Cite key={j} c={c} />
              ))}
            </Box>
          )}
        </Box>
      ))}

      {digest.movers.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={P.up}>MOVERS</Text>
          <Box>
            {digest.movers.map((m) => {
              const up = m.change_pct >= 0;
              return (
                <Box key={m.symbol} marginRight={2}>
                  <Text>
                    <Text color={P.fg}>{m.symbol} </Text>
                    <Text color={P.dim}>{fmtPrice(m.price)} </Text>
                    <Text color={up ? P.up : P.down}>
                      {up ? "▲" : "▼"}
                      {Math.abs(m.change_pct).toFixed(2)}%
                    </Text>
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
