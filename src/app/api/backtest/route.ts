import { NextResponse } from "next/server";

import { getBacktestIndex, runBacktest } from "@/lib/backtest-data";
import type { BacktestQuery, MarketId } from "@/lib/backtest-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKETS = new Set<MarketId>(["home", "draw", "away", "over25", "under25"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BacktestQuery>;
    const index = await getBacktestIndex();
    const validLeagues = new Set(Object.keys(index.meta.leagueCounts));
    const validSeasons = new Set(index.meta.availableSeasons);
    const validFilters = new Set(index.filters.map((filter) => filter.id));
    const market = MARKETS.has(body.market as MarketId)
      ? (body.market as MarketId)
      : "over25";
    const leagues = (body.leagues ?? []).filter((league) =>
      validLeagues.has(league),
    );
    const seasons = (body.seasons ?? []).filter((season) =>
      validSeasons.has(season),
    );
    const legacyFilters = (body as { filters?: unknown }).filters;
    const rawGroups = Array.isArray(body.filterGroups)
      ? body.filterGroups
      : Array.isArray(legacyFilters)
        ? legacyFilters.map((filter) => [filter])
        : [];
    const seen = new Set<string>();
    const filterGroups: string[][] = [];
    for (const group of rawGroups) {
      if (!Array.isArray(group)) continue;
      const clean: string[] = [];
      for (const filter of group) {
        if (
          typeof filter === "string" &&
          validFilters.has(filter) &&
          !seen.has(filter) &&
          seen.size < index.meta.maxFilters
        ) {
          seen.add(filter);
          clean.push(filter);
        }
      }
      if (clean.length) filterGroups.push(clean);
    }

    const query: BacktestQuery = {
      market,
      leagues: leagues.length ? leagues : Object.keys(index.meta.leagueCounts),
      seasons: seasons.length ? seasons : index.meta.defaultSeasons,
      filterGroups,
      minBets: Math.min(Math.max(Number(body.minBets) || 100, 10), 10_000),
    };

    return NextResponse.json(await runBacktest(query));
  } catch (error) {
    console.error("Backtest request failed", error);
    return NextResponse.json(
      { error: "The backtest could not be calculated." },
      { status: 500 },
    );
  }
}
