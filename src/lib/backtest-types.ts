export type MarketId = "home" | "draw" | "away" | "over25" | "under25";

export interface FilterDefinition {
  id: string;
  label: string;
  description: string;
  category: string;
  requiresJson: boolean;
  matches: number;
  rawMatches?: number;
}

export interface RetiredFilter extends FilterDefinition {
  reason: string;
}

export interface IndexMeta {
  schemaVersion?: number;
  firstSeason: string;
  minFilterMatches: number;
  candidateFilterCount: number;
  removedFilters: RetiredFilter[];
  generatedAt: string;
  cutoffDate: string;
  firstMatchDate: string;
  lastMatchDate: string;
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
  competitions: CompetitionCoverage[];
}

export interface CompetitionCoverage {
  code: string;
  name: string;
  country: string;
  kind: "domestic" | "uefa";
  calendarYear: boolean;
  matches: number;
  eventMatches: number;
  featureCounts: Record<string, number>;
  markets: Record<MarketId, number>;
  betfairMarkets: Record<MarketId, number>;
  marketLastDates: Record<MarketId, string | null>;
  firstDate: string;
  lastDate: string;
  lastOddsDate: string | null;
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
  oddsTypes?: Record<MarketId, "bookmaker" | "betfair" | null>;
  betfairMinutes?: Partial<Record<MarketId, number>>;
  /** v2 uses filter ordinals to keep the expanded download compact. */
  filterHits: Array<string | number>;
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
  betfairCommission?: number;
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
  oddsType: "bookmaker" | "betfair";
  priceMinute?: number;
}

export interface BacktestResponse {
  query: BacktestQuery;
  poolMatches: number;
  qualifyingMatches: number;
  missingOdds: number;
  betfairBets: number;
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
