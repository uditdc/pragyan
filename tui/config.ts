import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export interface TuiConfig {
  matrix_rain: boolean;
}

export const config: TuiConfig = JSON.parse(
  readFileSync(join(here, "config.json"), "utf8"),
);
