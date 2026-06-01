import { Box, Text } from "ink";
import type { MarketsSnapshot } from "../shared/market.ts";
import { P } from "./theme.ts";
import { Ticker } from "./Ticker.tsx";
import { PolymarketRow } from "./PolymarketRow.tsx";
import { fmtClock } from "./format.ts";

export type MarketTab = "crypto" | "nifty" | "polymarket";

const META: Record<MarketTab, { title: string; color: string }> = {
  crypto: { title: "CRYPTO", color: P.x },
  nifty: { title: "NIFTY", color: P.news },
  polymarket: { title: "POLYMARKET — top by 24h volume", color: P.log },
};

export function MarketView({
  tab,
  markets,
  width,
  height,
  now,
}: {
  tab: MarketTab;
  markets: MarketsSnapshot | null;
  width: number;
  height: number;
  now: number;
}) {
  const { title, color } = META[tab];
  const inner = Math.max(10, width - 2);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Box>
        <Text color={color} bold>
          {title}
        </Text>
        {markets ? (
          <Text color={P.faint}>
            {"   "}updated {fmtClock(Date.parse(markets.fetched_at) || now)}
            {markets.stale ? " · stale" : ""}
          </Text>
        ) : null}
      </Box>
      <Text color={P.rule}>{"─".repeat(inner)}</Text>

      {!markets ? (
        <Text color={P.faint}>loading markets …</Text>
      ) : tab === "polymarket" ? (
        markets.polymarkets.map((m, i) => (
          <Box key={m.id}>
            <Box width={3}>
              <Text color={P.faint}>{i + 1}</Text>
            </Box>
            <PolymarketRow m={m} width={inner - 3} />
          </Box>
        ))
      ) : (
        (tab === "crypto" ? markets.crypto : markets.indices).map((t) => (
          <Ticker key={t.symbol} t={t} />
        ))
      )}
    </Box>
  );
}
