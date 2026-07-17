import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BacktestIndex } from "@/lib/backtest-types";

let indexPromise: Promise<BacktestIndex> | null = null;

/**
 * Build-time index loader for server components. The browser fetches
 * /backtest-index.json and runs the engine locally (see backtest-engine.ts),
 * so the deployed site is fully static.
 */
export function getBacktestIndex(): Promise<BacktestIndex> {
  if (!indexPromise) {
    const indexPath = path.join(process.cwd(), "data", "backtest-index.json");
    indexPromise = readFile(indexPath, "utf8").then(
      (contents) => JSON.parse(contents) as BacktestIndex,
    );
  }
  return indexPromise;
}
