import { Box, Text } from "ink";
import type { MarketsSnapshot } from "../shared/market.ts";
import { P } from "./theme.ts";
import { InlineTicker } from "./Ticker.tsx";

export function MarketStrip({
  markets,
  width,
}: {
  markets: MarketsSnapshot | null;
  width: number;
}) {
  if (!markets) {
    return (
      <Box width={width} paddingX={1}>
        <Text color={P.faint}>markets …</Text>
      </Box>
    );
  }
  const btc = markets.crypto[0];
  const nifty = markets.indices[0];
  const sep = <Text color={P.faint}> · </Text>;

  return (
    <Box width={width} paddingX={1}>
      <Text wrap="truncate">
        {btc ? <InlineTicker t={btc} /> : null}
        {btc && nifty ? sep : null}
        {nifty ? <InlineTicker t={nifty} /> : null}
      </Text>
    </Box>
  );
}
