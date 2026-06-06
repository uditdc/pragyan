import { useMemo, type ReactNode } from "react";
import { Box, Text } from "ink";
import { P } from "./theme.ts";

const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789=+*<>".split("");
const DENSITY = 0.75;

function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface Column {
  active: boolean;
  speed: number;
  trail: number;
  phase: number;
}

interface Props {
  columns: number;
  rows: number;
  frame: number;
}

export function MatrixRain({ columns, rows, frame }: Props) {
  const cols = useMemo<Column[]>(() => {
    const out: Column[] = [];
    for (let x = 0; x < columns; x++) {
      const seed = x + 1;
      out.push({
        active: rand(seed) < DENSITY,
        speed: 0.12 + rand(seed * 7.3) * 0.3,
        trail: 3 + Math.floor(rand(seed * 3.1) * 6),
        phase: rand(seed * 5.7) * 1000,
      });
    }
    return out;
  }, [columns]);

  const lines = useMemo<ReactNode[]>(() => {
    const flicker = Math.floor(frame / 3);
    const out: ReactNode[] = [];

    for (let y = 0; y < rows; y++) {
      const segments: ReactNode[] = [];
      let gap = 0;
      let key = 0;

      for (let x = 0; x < columns; x++) {
        const col = cols[x];
        let color: string | null = null;

        if (col.active) {
          const cycle = rows + col.trail + 6;
          const head = Math.floor((frame * col.speed + col.phase) % cycle);
          const dist = head - y;
          if (dist >= 0 && dist < col.trail) {
            color = dist === 0 ? P.matrixHead : dist < 2 ? P.matrixBody : P.matrixTrail;
          }
        }

        if (color === null) {
          gap++;
          continue;
        }

        if (gap > 0) {
          segments.push(" ".repeat(gap));
          gap = 0;
        }
        const glyph = GLYPHS[Math.floor(rand(x * 31.7 + y * 7.3 + flicker) * GLYPHS.length)];
        segments.push(
          <Text key={key++} color={color}>
            {glyph}
          </Text>,
        );
      }

      out.push(<Text key={y}>{segments}</Text>);
    }
    return out;
  }, [cols, columns, rows, frame]);

  return (
    <Box position="absolute" flexDirection="column" width={columns} height={rows}>
      {lines}
    </Box>
  );
}
