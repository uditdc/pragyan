import type { ReactNode } from "react";
import { Box, Text } from "ink";
import type { MarketsSnapshot } from "../shared/market.ts";
import { P } from "./theme.ts";
import { PaneTicker } from "./Ticker.tsx";
import { PolymarketRow } from "./PolymarketRow.tsx";
import { fmtClock } from "./format.ts";
import { Panel } from "./Panel.tsx";

function Pane({
  title,
  color,
  width,
  children,
}: {
  title: string;
  color: string;
  width: number;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" width={width} flexShrink={0} overflow="hidden">
      <Text color={color} bold wrap="truncate">
        {title}
      </Text>
      <Text color={P.rule}>{"─".repeat(width)}</Text>
      {children}
    </Box>
  );
}

function Divider({ height }: { height: number }) {
  return (
    <Box width={1} flexShrink={0} marginX={1}>
      <Text color={P.rule}>{Array.from({ length: Math.max(1, height) }, () => "│").join("\n")}</Text>
    </Box>
  );
}

export function MarketView({
  markets,
  width,
  height,
  now,
}: {
  markets: MarketsSnapshot | null;
  width: number;
  height: number;
  now: number;
}) {
  const inner = Math.max(24, width - 6);
  const avail = inner - 6;
  const polyW = Math.max(24, Math.round(avail * 0.42));
  const rest = avail - polyW;
  const cryptoW = Math.floor(rest / 2);
  const indicesW = rest - cryptoW;
  const paneRows = Math.max(1, height - 4);

  const meta = markets
    ? `updated ${fmtClock(Date.parse(markets.fetched_at) || now)}${markets.stale ? " · stale" : ""}`
    : undefined;

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Panel icon="$" iconColor={P.up} title="MARKETS" meta={meta} width={width - 2} flexGrow={1}>
        {!markets ? (
          <Text color={P.faint}>loading markets …</Text>
        ) : (
          <Box flexDirection="row" flexGrow={1}>
            <Pane title="CRYPTO — by market cap" color={P.x} width={cryptoW}>
              {markets.crypto.map((t) => (
                <PaneTicker key={t.symbol} t={t} width={cryptoW} />
              ))}
            </Pane>
            <Divider height={paneRows} />
            <Pane title="INDICES & COMMODITIES" color={P.news} width={indicesW}>
              {markets.indices.map((t) => (
                <PaneTicker key={t.symbol} t={t} width={indicesW} />
              ))}
            </Pane>
            <Divider height={paneRows} />
            <Pane title="POLYMARKET — by 24h volume" color={P.log} width={polyW}>
              {markets.polymarkets.map((m, i) => (
                <Box key={m.id}>
                  <Box width={3} flexShrink={0}>
                    <Text color={P.faint}>{i + 1}</Text>
                  </Box>
                  <PolymarketRow m={m} width={polyW - 3} />
                </Box>
              ))}
            </Pane>
          </Box>
        )}
      </Panel>
    </Box>
  );
}
