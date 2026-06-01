import { Text } from "ink";
import type { Citation } from "../shared/summary.ts";
import { P } from "./theme.ts";

export function Cite({ c }: { c: Citation }) {
  const color = c.source === "news" ? P.news : P.x;
  return (
    <Text wrap="truncate">
      <Text color={P.faint}>‹</Text>
      <Text color={color}>● </Text>
      <Text color={P.dim}>{c.label}</Text>
      <Text color={P.faint}>›{"  "}</Text>
    </Text>
  );
}
