import { Box, Text } from "ink";
import { P } from "./theme.ts";

export function MetaBar({
  label,
  color,
  frac,
  value,
  width,
}: {
  label: string;
  color: string;
  frac: number;
  value: string;
  width: number;
}) {
  const filled = Math.max(0, Math.min(width, Math.round(frac * width)));
  return (
    <Box>
      <Box width={5}>
        <Text color={color}>{label}</Text>
      </Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={P.rule}>{"░".repeat(Math.max(0, width - filled))}</Text>
      <Box flexGrow={1} />
      <Text color={P.dim}>{value}</Text>
    </Box>
  );
}
