"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Database,
  FlaskConical,
  Info,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { ResultsPanel } from "@/components/results-panel";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { runBacktest } from "@/lib/backtest-engine";
import type {
  BacktestIndex,
  BacktestQuery,
  BacktestResponse,
  FilterDefinition,
  IndexMeta,
  MarketId,
  SavedStrategy,
} from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

const SAVED_STRATEGIES_KEY = "bet-finder:saved-strategies:v1";
const CURRENT_STRATEGY_KEY = "bet-finder:current-strategy:v1";

const MARKETS: Array<{ id: MarketId; label: string }> = [
  { id: "over25", label: "Over 2.5 goals" },
  { id: "under25", label: "Under 2.5 goals" },
  { id: "home", label: "Home win" },
  { id: "draw", label: "Draw" },
  { id: "away", label: "Away win" },
];

function marketLabel(id: MarketId): string {
  return MARKETS.find((market) => market.id === id)?.label ?? id;
}

interface StrategyDashboardProps {
  filters: FilterDefinition[];
  meta: IndexMeta;
}

/** Older saves stored a flat `filters` list; convert it to one-per-group AND. */
function toGroups(raw: unknown, legacy: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(legacy)) return legacy.map((filter) => [filter]);
  return [];
}

function sanitizeGroups(
  raw: unknown,
  validIds: Set<string>,
  maxFilters: number,
): string[][] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const group of raw) {
    if (!Array.isArray(group)) continue;
    const clean: string[] = [];
    for (const filter of group) {
      if (
        typeof filter === "string" &&
        validIds.has(filter) &&
        !seen.has(filter) &&
        seen.size < maxFilters
      ) {
        seen.add(filter);
        clean.push(filter);
      }
    }
    if (clean.length) groups.push(clean);
  }
  return groups;
}

function readSavedStrategies(validIds: Set<string>, maxFilters: number): SavedStrategy[] {
  try {
    const saved = window.localStorage.getItem(SAVED_STRATEGIES_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as Array<SavedStrategy & { filters?: string[] }>;
    return parsed.map((item) => ({
      ...item,
      filterGroups: sanitizeGroups(toGroups(item.filterGroups, item.filters), validIds, maxFilters),
    }));
  } catch {
    return [];
  }
}

function writeSavedStrategies(strategies: SavedStrategy[]) {
  window.localStorage.setItem(SAVED_STRATEGIES_KEY, JSON.stringify(strategies));
}

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function StrategyDashboard({ filters, meta }: StrategyDashboardProps) {
  const allLeagues = useMemo(() => Object.keys(meta.leagueCounts), [meta.leagueCounts]);
  const validFilterIds = useMemo(() => new Set(filters.map((filter) => filter.id)), [filters]);
  const [market, setMarket] = useState<MarketId>("over25");
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>(allLeagues);
  const [selectedSeasons, setSelectedSeasons] = useState<string[]>(meta.defaultSeasons);
  const [filterGroups, setFilterGroups] = useState<string[][]>([]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [minBets, setMinBets] = useState(100);
  const [filterSearch, setFilterSearch] = useState("");
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [index, setIndex] = useState<BacktestIndex | null>(null);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([]);
  const [strategiesDialogOpen, setStrategiesDialogOpen] = useState(false);
  const [strategyName, setStrategyName] = useState("");

  const filtersById = useMemo(
    () => new Map(filters.map((filter) => [filter.id, filter])),
    [filters],
  );

  const flatFilters = useMemo(() => filterGroups.flat(), [filterGroups]);
  const capReached = flatFilters.length >= meta.maxFilters;
  const currentActiveGroup = Math.min(activeGroup, Math.max(filterGroups.length - 1, 0));

  // Restore the saved strategy list and the in-progress setup from the last visit.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedStrategies(readSavedStrategies(validFilterIds, meta.maxFilters));
      try {
        const raw = window.localStorage.getItem(CURRENT_STRATEGY_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<BacktestQuery> & { filters?: string[] };
          if (saved.market && MARKETS.some((item) => item.id === saved.market)) {
            setMarket(saved.market);
          }
          if (Array.isArray(saved.leagues)) {
            const leagues = saved.leagues.filter((league) => allLeagues.includes(league));
            if (leagues.length) setSelectedLeagues(leagues);
          }
          if (Array.isArray(saved.seasons)) {
            const seasons = saved.seasons.filter((season) => meta.availableSeasons.includes(season));
            if (seasons.length) setSelectedSeasons(seasons);
          }
          setFilterGroups(
            sanitizeGroups(toGroups(saved.filterGroups, saved.filters), validFilterIds, meta.maxFilters),
          );
          if (typeof saved.minBets === "number") {
            setMinBets(Math.min(Math.max(saved.minBets, 10), 10_000));
          }
        }
      } catch {
        // A malformed stored setup falls back to the defaults.
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      CURRENT_STRATEGY_KEY,
      JSON.stringify({ market, leagues: selectedLeagues, seasons: selectedSeasons, filterGroups, minBets }),
    );
  }, [filterGroups, hydrated, market, minBets, selectedLeagues, selectedSeasons]);

  // Load the match index once; the whole backtest runs in the browser so the
  // deployed site needs nothing but static files.
  useEffect(() => {
    if (index) return;
    const controller = new AbortController();
    (async () => {
      setError(null);
      try {
        const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        const response = await fetch(`${base}/backtest-index.json`, { signal: controller.signal });
        if (!response.ok) throw new Error("The match index could not be loaded.");
        setIndex((await response.json()) as BacktestIndex);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "The match index could not be loaded.");
        setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  useEffect(() => {
    if (!index) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const query: BacktestQuery = {
        market,
        leagues: selectedLeagues,
        seasons: selectedSeasons,
        filterGroups: filterGroups.filter((group) => group.length > 0),
        minBets,
      };
      try {
        setResult(runBacktest(index, query));
      } catch {
        setError("The backtest could not be calculated.");
      } finally {
        setLoading(false);
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [filterGroups, index, market, minBets, retryToken, selectedLeagues, selectedSeasons]);

  const filteredCategories = useMemo(() => {
    const search = filterSearch.trim().toLocaleLowerCase();
    const categories = new Map<string, FilterDefinition[]>();
    for (const filter of filters) {
      if (
        search &&
        !`${filter.label} ${filter.description} ${filter.category}`.toLocaleLowerCase().includes(search)
      ) {
        continue;
      }
      categories.set(filter.category, [...(categories.get(filter.category) ?? []), filter]);
    }
    return Array.from(categories);
  }, [filterSearch, filters]);

  const searching = filterSearch.trim().length > 0;

  const ruleSummary = useMemo(() => {
    const parts = filterGroups
      .filter((group) => group.length > 0)
      .map((group) => {
        const labels = group.map((id) => filtersById.get(id)?.label ?? id);
        return labels.length > 1 ? `(${labels.join(" OR ")})` : labels[0];
      });
    return parts.join(" AND ");
  }, [filterGroups, filtersById]);

  function toggleFilter(filterId: string) {
    setFilterGroups((current) => {
      const owner = current.findIndex((group) => group.includes(filterId));
      if (owner >= 0) {
        return current
          .map((group, index) => (index === owner ? group.filter((id) => id !== filterId) : group))
          .filter((group) => group.length > 0);
      }
      if (current.flat().length >= meta.maxFilters) return current;
      if (!current.length) return [[filterId]];
      const target = Math.min(currentActiveGroup, current.length - 1);
      return current.map((group, index) => (index === target ? [...group, filterId] : group));
    });
  }

  function addAndGroup() {
    const trailingEmpty = filterGroups.length > 0 && filterGroups[filterGroups.length - 1].length === 0;
    if (!trailingEmpty) setFilterGroups([...filterGroups, []]);
    setActiveGroup(trailingEmpty ? filterGroups.length - 1 : filterGroups.length);
  }

  function removeGroup(index: number) {
    setFilterGroups((current) => current.filter((_, i) => i !== index));
    setActiveGroup(0);
  }

  function toggleRequiredSelection(
    value: string,
    current: string[],
    update: (next: string[]) => void,
  ) {
    if (current.includes(value)) {
      if (current.length > 1) update(current.filter((item) => item !== value));
    } else {
      update([...current, value]);
    }
  }

  function resetStrategy() {
    setMarket("over25");
    setSelectedLeagues(allLeagues);
    setSelectedSeasons(meta.defaultSeasons);
    setFilterGroups([]);
    setActiveGroup(0);
    setMinBets(100);
    setFilterSearch("");
    setOpenCategories([]);
  }

  function saveStrategy() {
    const name = strategyName.trim();
    if (!name) return;
    const strategy: SavedStrategy = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      market,
      leagues: selectedLeagues,
      seasons: selectedSeasons,
      filterGroups: filterGroups.filter((group) => group.length > 0),
      minBets,
    };
    const next = [strategy, ...savedStrategies].slice(0, 30);
    setSavedStrategies(next);
    writeSavedStrategies(next);
    setStrategyName("");
  }

  function loadStrategy(id: string) {
    const strategy = savedStrategies.find((item) => item.id === id);
    if (!strategy) return;
    setMarket(strategy.market);
    setSelectedLeagues(strategy.leagues);
    setSelectedSeasons(strategy.seasons);
    setFilterGroups(sanitizeGroups(strategy.filterGroups, validFilterIds, meta.maxFilters));
    setActiveGroup(0);
    setMinBets(strategy.minBets);
    setStrategiesDialogOpen(false);
  }

  function deleteStrategy(id: string) {
    const next = savedStrategies.filter((item) => item.id !== id);
    setSavedStrategies(next);
    writeSavedStrategies(next);
  }

  function strategyFilterCount(strategy: SavedStrategy): number {
    return strategy.filterGroups.reduce((count, group) => count + group.length, 0);
  }

  const generatedDate = shortDate.format(new Date(meta.generatedAt));

  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1800px] items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_28px_-8px_var(--primary)]">
              <Target className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight">Bet Finder</div>
              <div className="truncate text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Pre-match research</div>
            </div>
            <Separator className="mx-3 hidden h-6 md:block" orientation="vertical" />
            <nav className="hidden items-center gap-1 text-sm md:flex">
              <Button className="text-foreground" size="sm" variant="ghost">Strategy builder</Button>
              <Button disabled size="sm" variant="ghost">
                Saved portfolios <span className="text-[9px] uppercase text-muted-foreground">soon</span>
              </Button>
              <Button disabled size="sm" variant="ghost">
                Upcoming matches <span className="text-[9px] uppercase text-muted-foreground">soon</span>
              </Button>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge className="hidden gap-1.5 lg:inline-flex" variant="outline">
              <Database className="size-3" /> {meta.matchCount.toLocaleString()} indexed matches
            </Badge>
            <Button onClick={() => setStrategiesDialogOpen(true)} size="sm" variant="outline">
              <Bookmark data-icon="inline-start" /> My strategies
              {savedStrategies.length > 0 && (
                <span className="metric-number text-[10px] text-muted-foreground">{savedStrategies.length}</span>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-6 md:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="secondary">Local first draft</Badge>
              <span className="metric-number text-[11px] text-muted-foreground">Index rebuilt {generatedDate}</span>
            </div>
            <h1 className="text-3xl font-medium tracking-[-0.045em]">Build a pre-match strategy</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Combine up to five signals into AND + OR rules. A match must pass every group, and it passes a group when any filter inside it applies.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={resetStrategy} variant="ghost">
              <RotateCcw data-icon="inline-start" /> Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card className="gap-4 border-border/80 bg-card/80 py-4 shadow-none">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base font-medium">
                    <SlidersHorizontal className="size-4 text-primary" /> Strategy setup
                  </CardTitle>
                  <Badge variant="outline">AND + OR</Badge>
                </div>
                <CardDescription>Groups combine with AND; filters inside a group combine with OR.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 px-4">
                <div className="space-y-2">
                  <Label htmlFor="market">Bet market</Label>
                  <Select value={market} onValueChange={(value) => setMarket(value as MarketId)}>
                    <SelectTrigger className="w-full" id="market">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Leagues</Label>
                    {selectedLeagues.length < allLeagues.length ? (
                      <Button
                        className="h-auto px-1.5 py-0.5 text-[11px]"
                        onClick={() => setSelectedLeagues(allLeagues)}
                        size="sm"
                        variant="ghost"
                      >
                        Select all
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Top five</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {allLeagues.map((league) => {
                      const selected = selectedLeagues.includes(league);
                      return (
                        <Button
                          aria-pressed={selected}
                          className={cn("justify-start", selected && "border-primary/40 bg-primary/10 text-primary")}
                          key={league}
                          onClick={() =>
                            toggleRequiredSelection(league, selectedLeagues, setSelectedLeagues)
                          }
                          size="sm"
                          variant="outline"
                        >
                          {league}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label>Seasons</Label>
                    <span className="text-[11px] text-muted-foreground">Current season is opt-in</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {meta.availableSeasons.map((season) => {
                      const selected = selectedSeasons.includes(season);
                      const current = season === meta.currentSeason;
                      return (
                        <Button
                          aria-pressed={selected}
                          className={cn("justify-between", selected && "border-primary/40 bg-primary/10 text-primary")}
                          key={season}
                          onClick={() =>
                            toggleRequiredSelection(season, selectedSeasons, setSelectedSeasons)
                          }
                          size="sm"
                          variant="outline"
                        >
                          {season.replace("20", "").replace("-20", "/")}
                          {current && <span className="text-[9px] uppercase">live</span>}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-bets">Small-sample threshold</Label>
                  <Input
                    id="min-bets"
                    max={10000}
                    min={10}
                    onChange={(event) => setMinBets(Math.max(10, Number(event.target.value) || 10))}
                    type="number"
                    value={minBets}
                  />
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Results with fewer settled bets than this are flagged as too small to trust.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-3 border-border/80 bg-card/80 py-4 shadow-none">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">Rule builder</CardTitle>
                  <div className="flex items-center gap-2">
                    {flatFilters.length > 0 && (
                      <Button
                        className="h-auto px-1.5 py-0.5 text-[11px]"
                        onClick={() => {
                          setFilterGroups([]);
                          setActiveGroup(0);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Clear all
                      </Button>
                    )}
                    <span className="metric-number text-xs text-muted-foreground">
                      {flatFilters.length}/{meta.maxFilters}
                    </span>
                  </div>
                </div>
                <CardDescription>
                  Tick filters to add them to the highlighted group. Add an AND group to require another condition.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                {filterGroups.length > 0 && (
                  <div className="space-y-1">
                    {filterGroups.map((group, index) => {
                      const isActive = index === currentActiveGroup;
                      return (
                        <div key={index}>
                          {index > 0 && (
                            <div className="py-0.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              and
                            </div>
                          )}
                          <div
                            className={cn(
                              "cursor-pointer rounded-lg border p-2 transition-colors",
                              isActive
                                ? "border-primary/50 bg-primary/5"
                                : "border-border/80 hover:border-muted-foreground/40",
                            )}
                            onClick={() => setActiveGroup(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") setActiveGroup(index);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                Group {index + 1} · match any{isActive && " · adding here"}
                              </span>
                              <Button
                                aria-label={`Remove group ${index + 1}`}
                                className="-mr-1 size-4 rounded-full p-0 hover:bg-foreground/10"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeGroup(index);
                                }}
                                size="icon-xs"
                                variant="ghost"
                              >
                                <X className="size-2.5" />
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {group.length === 0 && (
                                <span className="text-[11px] text-muted-foreground">
                                  Tick filters below to add them here.
                                </span>
                              )}
                              {group.map((id, filterIndex) => (
                                <span className="flex items-center gap-1.5" key={id}>
                                  {filterIndex > 0 && (
                                    <span className="text-[9px] font-semibold uppercase text-muted-foreground">or</span>
                                  )}
                                  <Badge className="h-auto gap-1 py-1" variant="secondary">
                                    {filtersById.get(id)?.label ?? id}
                                    <Button
                                      aria-label={`Remove ${filtersById.get(id)?.label ?? id}`}
                                      className="-mr-1 size-4 rounded-full p-0 hover:bg-foreground/10"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleFilter(id);
                                      }}
                                      size="icon-xs"
                                      variant="ghost"
                                    >
                                      <X className="size-2.5" />
                                    </Button>
                                  </Badge>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={capReached}
                  onClick={addAndGroup}
                  size="sm"
                  variant="outline"
                >
                  <Plus data-icon="inline-start" /> {filterGroups.length ? "Add AND group" : "Start a rule"}
                </Button>

                {ruleSummary && (
                  <p className="metric-number rounded-lg bg-muted/40 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                    {ruleSummary}
                  </p>
                )}

                {capReached && (
                  <Alert>
                    <Info />
                    <AlertDescription>
                      Filter limit reached ({meta.maxFilters} across all groups) — remove one to try a different signal.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search filters"
                    className="pl-8"
                    onChange={(event) => setFilterSearch(event.target.value)}
                    placeholder={`Search ${meta.filterCount} filters…`}
                    value={filterSearch}
                  />
                </div>

                <ScrollArea className="h-[420px] pr-3 lg:h-[650px]">
                  {filteredCategories.length ? (
                    <Accordion
                      onValueChange={(value) => {
                        if (!searching) setOpenCategories(value);
                      }}
                      type="multiple"
                      value={searching ? filteredCategories.map(([category]) => category) : openCategories}
                    >
                      {filteredCategories.map(([category, categoryFilters]) => (
                        <AccordionItem key={category} value={category}>
                          <AccordionTrigger className="text-xs">
                            <span className="flex items-center gap-2">
                              {category}
                              <span className="metric-number text-[10px] text-muted-foreground">
                                {categoryFilters.length}
                              </span>
                              {!searching &&
                                categoryFilters.some((filter) => flatFilters.includes(filter.id)) && (
                                  <span className="size-1.5 rounded-full bg-primary" />
                                )}
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="space-y-1 pb-3">
                            {categoryFilters.map((filter) => {
                              const selected = flatFilters.includes(filter.id);
                              const disabled = !selected && capReached;
                              return (
                                <label
                                  className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60",
                                    selected && "bg-primary/8",
                                    disabled && "cursor-not-allowed opacity-45",
                                  )}
                                  htmlFor={filter.id}
                                  key={filter.id}
                                >
                                  <Checkbox
                                    checked={selected}
                                    disabled={disabled}
                                    id={filter.id}
                                    onCheckedChange={() => toggleFilter(filter.id)}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 text-xs font-medium leading-4">
                                      {filter.label}
                                      {filter.requiresJson && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Database className="size-3 shrink-0 text-muted-foreground" />
                                          </TooltipTrigger>
                                          <TooltipContent>Requires match-event enrichment</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </span>
                                    <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                                      {filter.description}
                                    </span>
                                  </span>
                                  <span className="metric-number text-[10px] text-muted-foreground">
                                    {filter.matches.toLocaleString()}
                                  </span>
                                </label>
                              );
                            })}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  ) : (
                    <div className="py-10 text-center text-sm text-muted-foreground">No filters match that search.</div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>

          <section className="min-w-0 space-y-4">
            <Alert className="border-primary/20 bg-primary/5">
              <FlaskConical className="text-primary" />
              <AlertTitle>Research result, not a prediction</AlertTitle>
              <AlertDescription>
                Results use maximum historical closing odds and flat one-unit stakes. Testing many combinations can produce attractive results by chance; confidence intervals help, but do not remove that risk.
              </AlertDescription>
            </Alert>
            <ResultsPanel
              error={error}
              loading={loading}
              onRetry={() => setRetryToken((token) => token + 1)}
              result={result}
            />
          </section>
        </div>
      </main>

      <footer className="mt-10 border-t">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground md:px-6">
          <span>Bet Finder · historical research only · 18+</span>
          <span>Data licensing must be confirmed before public launch.</span>
        </div>
      </footer>

      <Dialog open={strategiesDialogOpen} onOpenChange={setStrategiesDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>My strategies</DialogTitle>
            <DialogDescription>
              Strategies are saved in this browser only. Saving keeps the current market, leagues, seasons, rule groups and sample threshold.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="strategy-name">Save the current setup</Label>
            <div className="flex gap-2">
              <Input
                autoFocus
                id="strategy-name"
                maxLength={60}
                onChange={(event) => setStrategyName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveStrategy();
                }}
                placeholder="e.g. High xG goal candidates"
                value={strategyName}
              />
              <Button disabled={!strategyName.trim()} onClick={saveStrategy}>
                <Save data-icon="inline-start" /> Save
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Currently set: {marketLabel(market)} · {flatFilters.length} filter{flatFilters.length === 1 ? "" : "s"} in {filterGroups.filter((group) => group.length > 0).length} group{filterGroups.filter((group) => group.length > 0).length === 1 ? "" : "s"} · {selectedLeagues.length} league{selectedLeagues.length === 1 ? "" : "s"} · {selectedSeasons.length} season{selectedSeasons.length === 1 ? "" : "s"}
            </p>
          </div>

          <Separator />

          {savedStrategies.length ? (
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {savedStrategies.map((strategy) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/80 px-3 py-2"
                  key={strategy.id}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{strategy.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {marketLabel(strategy.market)} · {strategyFilterCount(strategy)} filter{strategyFilterCount(strategy) === 1 ? "" : "s"} in {strategy.filterGroups.length} group{strategy.filterGroups.length === 1 ? "" : "s"} · saved {shortDate.format(new Date(strategy.createdAt))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button onClick={() => loadStrategy(strategy.id)} size="sm" variant="outline">
                      Load
                    </Button>
                    <Button
                      aria-label={`Delete ${strategy.name}`}
                      onClick={() => deleteStrategy(strategy.id)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Nothing saved yet — name the current setup above to keep it.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
