import { Text } from "ink";
import { P } from "./theme.ts";

export interface Seg {
  t: string;
  c?: string;
  bold?: boolean;
}

const len = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.t].length, 0);

export function Bar({
  width,
  left,
  right,
}: {
  width: number;
  left: Seg[];
  right: Seg[];
}) {
  const gap = Math.max(1, width - len(left) - len(right) - 2);
  return (
    <Text backgroundColor={P.panel} wrap="truncate">
      {" "}
      {left.map((s, i) => (
        <Text key={`l${i}`} color={s.c} bold={s.bold}>
          {s.t}
        </Text>
      ))}
      {" ".repeat(gap)}
      {right.map((s, i) => (
        <Text key={`r${i}`} color={s.c} bold={s.bold}>
          {s.t}
        </Text>
      ))}
      {" "}
    </Text>
  );
}
