import { Text } from "ink";
import { P } from "./theme.ts";

export interface Seg {
  t: string;
  c?: string;
  bold?: boolean;
}

const len = (segs: Seg[]) => segs.reduce((n, s) => n + [...s.t].length, 0);

const render = (segs: Seg[], side: string) =>
  segs.map((s, i) => (
    <Text key={`${side}${i}`} color={s.c} bold={s.bold}>
      {s.t}
    </Text>
  ));

export function Bar({
  width,
  left,
  center = [],
  right,
}: {
  width: number;
  left: Seg[];
  center?: Seg[];
  right: Seg[];
}) {
  const inner = Math.max(0, width - 2);

  if (center.length === 0) {
    const gap = Math.max(1, inner - len(left) - len(right));
    return (
      <Text backgroundColor={P.panel} wrap="truncate">
        {" "}
        {render(left, "l")}
        {" ".repeat(gap)}
        {render(right, "r")}
        {" "}
      </Text>
    );
  }

  const L = len(left);
  const C = len(center);
  const R = len(right);
  const centerStart = Math.max(L + 1, Math.floor((inner - C) / 2));
  const gap1 = Math.max(1, centerStart - L);
  const gap2 = Math.max(1, inner - R - L - gap1 - C);

  return (
    <Text backgroundColor={P.panel} wrap="truncate">
      {" "}
      {render(left, "l")}
      {" ".repeat(gap1)}
      {render(center, "c")}
      {" ".repeat(gap2)}
      {render(right, "r")}
      {" "}
    </Text>
  );
}
