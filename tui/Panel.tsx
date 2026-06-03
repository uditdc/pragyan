import type { ReactNode } from "react";
import { Box, Text } from "ink";
import { P } from "./theme.ts";

export function Panel({
  icon,
  iconColor,
  title,
  meta,
  focus,
  width,
  height,
  flexGrow,
  children,
}: {
  icon?: string;
  iconColor?: string;
  title: string;
  meta?: ReactNode;
  focus?: boolean;
  width?: number;
  height?: number;
  flexGrow?: number;
  children: ReactNode;
}) {
  const cw = Math.max(4, (width ?? 0) - 4);
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      minHeight={0}
      borderStyle="round"
      borderColor={focus ? P.accent : P.rule}
      paddingX={1}
      overflow="hidden"
    >
      <Box>
        {icon ? <Text color={iconColor ?? P.faint}>{icon} </Text> : null}
        <Text color={focus ? P.white : P.dim} bold>
          {title}
        </Text>
        <Box flexGrow={1} />
        {meta != null
          ? typeof meta === "string"
            ? <Text color={P.faint}>{meta}</Text>
            : meta
          : null}
      </Box>
      {width ? <Text color={P.rule}>{"─".repeat(cw)}</Text> : null}
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}
