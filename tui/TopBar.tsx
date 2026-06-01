import { P } from "./theme.ts";
import { Bar, type Seg } from "./Bar.tsx";

interface Props {
  width: number;
  online: boolean;
  count: number;
  newsOnly: boolean;
  minScore: number;
  clock: string;
}

export function TopBar({ width, online, count, newsOnly, minScore, clock }: Props) {
  const left: Seg[] = [
    { t: "◆ ", c: P.accent },
    { t: "XFEED  ", c: P.white, bold: true },
    { t: "read-only   ", c: P.faint },
    { t: "all ", c: newsOnly ? P.faint : P.fg },
    { t: "news ", c: newsOnly ? P.news : P.faint },
    { t: `· min ${minScore.toFixed(1)}`, c: P.faint },
  ];
  const right: Seg[] = [
    { t: "● ", c: online ? P.accent : P.down },
    { t: online ? "LIVE " : "OFFLINE ", c: P.dim },
    { t: `${count} · ${clock}`, c: P.faint },
  ];
  return <Bar width={width} left={left} right={right} />;
}
