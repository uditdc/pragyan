import { Box, Text } from "ink";
import type { PredictionMarket } from "../shared/market.ts";
import { P } from "./theme.ts";
import { fmtCount } from "./format.ts";

export function PolymarketRow({ m, width }: { m: PredictionMarket; width: number }) {
  const pct = Math.round(m.probability * 100);
  return (
    <Box width={width}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate" color={P.dim}>
          {m.question}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text>
          <Text color={P.fg}>{m.outcome} </Text>
          <Text color={P.accent}>{pct}%</Text>
          <Text color={P.faint}>  ${fmtCount(m.volume24h)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
