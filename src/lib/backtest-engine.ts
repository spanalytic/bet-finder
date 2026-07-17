import type {
  BacktestIndex,
  BacktestQuery,
  BacktestResponse,
  BreakdownRow,
  IndexedMatch,
  MarketId,
  ResultMatch,
  SummaryMetrics,
} from "@/lib/backtest-types";

function marketWon(match: IndexedMatch, market: MarketId): boolean {
  if (market === "home") return match.result === "H";
  if (market === "draw") return match.result === "D";
  if (market === "away") return match.result === "A";
  if (market === "over25") return match.homeGoals + match.awayGoals > 2;
  return match.homeGoals + match.awayGoals <= 2;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function wilsonInterval(wins: number, total: number): [number, number] | null {
  if (!total) return null;
  const z = 1.96;
  const probability = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = (probability + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (probability * (1 - probability)) / total +
        (z * z) / (4 * total * total),
    );
  return [round((centre - margin) * 100, 1), round((centre + margin) * 100, 1)];
}

function summarise(rows: ResultMatch[]): SummaryMetrics {
  if (!rows.length) {
    return {
      bets: 0,
      wins: 0,
      profit: 0,
      roi: 0,
      winRate: 0,
      averageOdds: 0,
      maxDrawdown: 0,
      roiCi: null,
      winRateCi: null,
    };
  }

  const profits = rows.map((row) => row.profit);
  const totalProfit = profits.reduce((sum, value) => sum + value, 0);
  const wins = rows.reduce((sum, row) => sum + (row.won ? 1 : 0), 0);
  const mean = totalProfit / rows.length;
  let peak = 0;
  let running = 0;
  let maxDrawdown = 0;
  for (const profit of profits) {
    running += profit;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  let roiCi: [number, number] | null = null;
  if (rows.length > 1) {
    const variance =
      profits.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (rows.length - 1);
    const margin = 1.96 * Math.sqrt(variance / rows.length);
    roiCi = [round((mean - margin) * 100, 1), round((mean + margin) * 100, 1)];
  }

  return {
    bets: rows.length,
    wins,
    profit: round(totalProfit),
    roi: round(mean * 100, 1),
    winRate: round((wins / rows.length) * 100, 1),
    averageOdds: round(
      rows.reduce((sum, row) => sum + row.odds, 0) / rows.length,
    ),
    maxDrawdown: round(maxDrawdown),
    roiCi,
    winRateCi: wilsonInterval(wins, rows.length),
  };
}

function breakdown(rows: ResultMatch[], key: "league" | "season"): BreakdownRow[] {
  const groups = new Map<string, ResultMatch[]>();
  for (const row of rows) {
    const label = row[key];
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups, ([label, group]) => {
    const summary = summarise(group);
    return {
      label,
      bets: summary.bets,
      wins: summary.wins,
      profit: summary.profit,
      roi: summary.roi,
      winRate: summary.winRate,
      averageOdds: summary.averageOdds,
    };
  }).sort((a, b) =>
    key === "season" ? a.label.localeCompare(b.label) : b.bets - a.bets,
  );
}

function downsampleCurve(
  points: Array<{ date: string; profit: number }>,
  maxPoints = 140,
) {
  if (points.length <= maxPoints) return points;
  return Array.from({ length: maxPoints }, (_, index) => {
    const pointIndex = Math.round(
      (index / (maxPoints - 1)) * (points.length - 1),
    );
    return points[pointIndex];
  });
}

export function runBacktest(
  index: BacktestIndex,
  query: BacktestQuery,
): BacktestResponse {
  const groups = query.filterGroups.filter((group) => group.length > 0);
  const selectedFilters = new Set(groups.flat());
  const selectedLeagues = new Set(query.leagues);
  const selectedSeasons = new Set(query.seasons);
  const filtersById = new Map(index.filters.map((filter) => [filter.id, filter]));

  const pool = index.matches.filter(
    (match) =>
      selectedLeagues.has(match.league) && selectedSeasons.has(match.season),
  );
  const qualifying = groups.length
    ? pool.filter((match) =>
        groups.every((group) =>
          group.some((filter) => match.filterHits.includes(filter)),
        ),
      )
    : pool;

  const resultRows: ResultMatch[] = [];
  let missingOdds = 0;
  for (const match of qualifying) {
    const odds = match.odds[query.market];
    if (!odds || odds <= 1) {
      missingOdds += 1;
      continue;
    }
    const won = marketWon(match, query.market);
    resultRows.push({
      id: match.id,
      league: match.league,
      season: match.season,
      date: match.date,
      home: match.home,
      away: match.away,
      score: `${match.homeGoals}–${match.awayGoals}`,
      odds,
      won,
      profit: round(won ? odds - 1 : -1),
      matchedFilters: match.filterHits.filter((filter) =>
        selectedFilters.has(filter),
      ),
    });
  }
  resultRows.sort((a, b) => a.date.localeCompare(b.date));

  let runningProfit = 0;
  const equityCurve = resultRows.map((row) => {
    runningProfit += row.profit;
    return { date: row.date, profit: round(runningProfit) };
  });

  const needsEnrichment = [...selectedFilters].some(
    (filter) => filtersById.get(filter)?.requiresJson,
  );
  const enrichmentCoverage = needsEnrichment
    ? round(
        (pool.filter((match) => match.jsonAvailable).length /
          Math.max(pool.length, 1)) *
          100,
        1,
      )
    : null;

  return {
    query,
    poolMatches: pool.length,
    qualifyingMatches: qualifying.length,
    missingOdds,
    enrichmentCoverage,
    metrics: summarise(resultRows),
    byLeague: breakdown(resultRows, "league"),
    bySeason: breakdown(resultRows, "season"),
    equityCurve: downsampleCurve(equityCurve),
    matches: resultRows.slice(-100).reverse(),
  };
}
