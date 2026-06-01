import { Box, Text } from "ink";
import type { Ticker as TickerData } from "../shared/market.ts";
import { P, marketColor } from "./theme.ts";
import { fmtPrice } from "./format.ts";

export function Ticker({ t }: { t: TickerData }) {
  const up = t.change_pct >= 0;
  const c = marketColor(up);
  const sign = up ? "+" : "";
  return (
    <Box>
      <Box width={10}>
        <Text color={P.fg}>{t.symbol}</Text>
      </Box>
      <Box width={12} justifyContent="flex-end">
        <Text color={P.dim}>{fmtPrice(t.price)}</Text>
      </Box>
      <Box width={16} justifyContent="flex-end">
        <Text color={c}>
          {up ? "▲" : "▼"} {sign}
          {t.change_pct.toFixed(2)}%
        </Text>
      </Box>
      <Box marginLeft={1}>
        <Text color={P.faint}>{t.currency}</Text>
      </Box>
    </Box>
  );
}

export function InlineTicker({ t }: { t: TickerData }) {
  const up = t.change_pct >= 0;
  return (
    <Text>
      <Text color={P.fg}>{t.symbol} </Text>
      <Text color={P.dim}>{fmtPrice(t.price)} </Text>
      <Text color={marketColor(up)}>
        {up ? "▲" : "▼"}
        {Math.abs(t.change_pct).toFixed(2)}%
      </Text>
    </Text>
  );
}
