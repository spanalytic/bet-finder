export type MarketId = "home" | "draw" | "away" | "over25" | "under25";

export interface FilterDefinition {
  id: string;
  label: string;
  description: string;
  category: string;
  requiresJson: boolean;
  matches: number;
}

export interface IndexMeta {
  generatedAt: string;
  matchCount: number;
  filterCount: number;
  defaultSeasons: string[];
  availableSeasons: string[];
  currentSeason: string;
  logic: string;
  maxFilters: number;
  leagueCounts: Record<string, number>;
  seasonCounts: Record<string, number>;
  methodology: string;
}

export interface IndexedMatch {
  id: string;
  league: string;
  leagueCode: string;
  season: string;
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  result: "H" | "D" | "A";
  odds: Record<MarketId, number | null>;
  filterHits: string[];
  jsonAvailable: boolean;
  oddsSource: string;
}

export interface BacktestIndex {
  meta: IndexMeta;
  filters: FilterDefinition[];
  matches: IndexedMatch[];
}

export interface BacktestQuery {
  market: MarketId;
  leagues: string[];
  seasons: string[];
  /** AND of OR-groups: a match must satisfy every group, and satisfies a group when any filter in it applies. */
  filterGroups: string[][];
  minBets: number;
}

export interface SummaryMetrics {
  bets: number;
  wins: number;
  profit: number;
  roi: number;
  winRate: number;
  averageOdds: number;
  maxDrawdown: number;
  roiCi: [number, number] | null;
  winRateCi: [number, number] | null;
}

export interface BreakdownRow {
  label: string;
  bets: number;
  wins: number;
  profit: number;
  roi: number;
  winRate: number;
  averageOdds: number;
}

export interface ResultMatch {
  id: string;
  league: string;
  season: string;
  date: string;
  home: string;
  away: string;
  score: string;
  odds: number;
  won: boolean;
  profit: number;
  matchedFilters: string[];
}

export interface BacktestResponse {
  query: BacktestQuery;
  poolMatches: number;
  qualifyingMatches: number;
  missingOdds: number;
  enrichmentCoverage: number | null;
  metrics: SummaryMetrics;
  byLeague: BreakdownRow[];
  bySeason: BreakdownRow[];
  equityCurve: Array<{ date: string; profit: number }>;
  matches: ResultMatch[];
}

export interface SavedStrategy extends BacktestQuery {
  id: string;
  name: string;
  createdAt: string;
}
