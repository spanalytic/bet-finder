"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Database,
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
import { ThemeToggle } from "@/components/theme-toggle";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
  const [orTargetGroup, setOrTargetGroup] = useState<number | null>(null);
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
      if (orTargetGroup !== null && current[orTargetGroup]) {
        return current.map((group, index) =>
          index === orTargetGroup ? [...group, filterId] : group,
        );
      }
      return [...current, [filterId]];
    });
    // An OR alternative is one explicit addition; subsequent filters use AND.
    setOrTargetGroup(null);
  }

  function removeGroup(index: number) {
    setFilterGroups((current) => current.filter((_, i) => i !== index));
    setOrTargetGroup(null);
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
    setOrTargetGroup(null);
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
    setOrTargetGroup(null);
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
      <a className="skip-link" href="#strategy-workspace">Skip to strategy builder</a>
      <header className="border-b border-border/70 bg-card/60">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Target className="size-5" />
            </div>
            <span className="truncate text-base font-semibold tracking-tight">Bet Finder<span className="text-primary">.</span></span>
            <span className="mx-3 hidden text-border md:inline" aria-hidden="true">/</span>
            <span className="hidden text-sm text-muted-foreground md:inline">Strategy workspace</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Button onClick={() => setStrategiesDialogOpen(true)} size="sm" variant="outline" className="bg-transparent">
              <Bookmark data-icon="inline-start" /> My strategies
              {savedStrategies.length > 0 && (
                <span className="metric-number text-[10px] text-muted-foreground">{savedStrategies.length}</span>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main id="strategy-workspace" className="mx-auto max-w-[1600px] px-4 py-6 md:px-8 md:py-7">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Pre-match research</p>
            <h1 className="text-[28px] font-semibold tracking-[-0.045em] md:text-[30px]">Strategy builder</h1>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              Find a signal. Build your rules. Explore the results.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground xl:inline">Updated {generatedDate}</span>
            <Button onClick={resetStrategy} variant="ghost" size="sm" className="text-muted-foreground">
              <RotateCcw data-icon="inline-start" /> Reset setup
            </Button>
          </div>
        </div>

        <section aria-label="Backtest settings" className="mb-7 rounded-2xl border border-border/80 bg-card">
          <div className="grid divide-y divide-border/70 sm:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[minmax(180px,0.8fr)_minmax(300px,1.5fr)_minmax(250px,1.2fr)] lg:divide-x lg:divide-y-0">
                <div className="space-y-3 p-5">
                  <Label className="text-xs text-muted-foreground" htmlFor="market">01 <span className="ml-1.5 text-foreground">Bet market</span></Label>
                  <Select value={market} onValueChange={(value) => setMarket(value as MarketId)}>
                    <SelectTrigger className="h-10 w-full bg-background/50" id="market">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 p-5 sm:border-t-0 sm:border-l lg:border-l-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">02 <span className="ml-1.5 text-foreground" id="leagues-label">Leagues</span></span>
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
                      <span className="text-[11px] text-muted-foreground">All five selected</span>
                    )}
                  </div>
                  <div role="group" aria-labelledby="leagues-label" className="flex flex-wrap gap-1.5">
                    {allLeagues.map((league) => {
                      const selected = selectedLeagues.includes(league);
                      return (
                        <Button
                          aria-pressed={selected}
                          className={cn("h-9 gap-1.5 rounded-lg border-transparent bg-secondary/60 px-2.5 text-xs text-muted-foreground hover:bg-secondary", selected && "border-primary/20 bg-primary/8 text-foreground")}
                          key={league}
                          onClick={() =>
                            toggleRequiredSelection(league, selectedLeagues, setSelectedLeagues)
                          }
                          size="sm"
                          variant="outline"
                        >
                          {selected && <Check className="size-3 text-primary" />} {league}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3 p-5 sm:col-span-2 lg:col-span-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">03 <span className="ml-1.5 text-foreground" id="seasons-label">Seasons</span></span>
                    <span className="text-[11px] text-muted-foreground">Current season is opt-in</span>
                  </div>
                  <div role="group" aria-labelledby="seasons-label" className="flex flex-wrap gap-1.5">
                    {meta.availableSeasons.map((season) => {
                      const selected = selectedSeasons.includes(season);
                      const current = season === meta.currentSeason;
                      return (
                        <Button
                          aria-pressed={selected}
                          className={cn("h-9 gap-1.5 rounded-lg border-transparent bg-secondary/60 px-2.5 text-xs text-muted-foreground hover:bg-secondary", selected && "border-primary/20 bg-primary/8 text-foreground")}
                          key={season}
                          onClick={() =>
                            toggleRequiredSelection(season, selectedSeasons, setSelectedSeasons)
                          }
                          size="sm"
                          variant="outline"
                        >
                          {selected && <Check className="size-3 text-primary" />}
                          {season.replace("20", "").replace("-20", "/")}
                          {current && <span className="size-1.5 rounded-full bg-primary" aria-label="Current season" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>

          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/70 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-2"><Database className="size-3.5" /> {meta.matchCount.toLocaleString()} matches available</span>
              <span>Maximum closing odds</span>
              <span>1u flat stake</span>
            </div>
            <details className="group w-full text-xs sm:w-auto sm:max-w-xs">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-foreground">
                <SlidersHorizontal className="size-3.5" /> Sample settings <ChevronDown className="ml-auto size-3 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 space-y-2 pb-2">
                  <Label className="text-xs" htmlFor="min-bets">Small-sample threshold</Label>
                  <Input
                    id="min-bets"
                    max={10000}
                    min={10}
                    onChange={(event) => setMinBets(Math.max(10, Number(event.target.value) || 10))}
                    type="number"
                    value={minBets}
                  />
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    Results below this number of settled bets receive a small-sample flag.
                  </p>
              </div>
            </details>
          </div>
        </section>

        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[290px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside aria-label="Strategy rules" className="min-w-0">
            <Card className="gap-0 rounded-2xl border border-border/80 bg-card py-0 shadow-none ring-0">
              <CardHeader className="gap-2 border-b border-border/70 px-5 py-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[15px] font-semibold">Your filters</CardTitle>
                  <div className="flex items-center gap-2">
                    {flatFilters.length > 0 && (
                      <Button
                        className="h-auto px-1.5 py-0.5 text-[11px]"
                        onClick={() => {
                          setFilterGroups([]);
                          setOrTargetGroup(null);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        Clear all
                      </Button>
                    )}
                    <span className="rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground">
                      {flatFilters.length} / {meta.maxFilters}
                    </span>
                  </div>
                </div>
                <CardDescription className="text-xs leading-5">
                  Filters use AND by default. Start with one or two signals; add up to five.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-5 pt-4 pb-5">
                {filterGroups.length > 0 && (
                  <div className="space-y-2">
                    {filterGroups.map((group, index) => {
                      const isActive = index === orTargetGroup;
                      return (
                        <div key={index}>
                          {index > 0 && (
                            <div className="flex items-center gap-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                              <span className="h-px flex-1 bg-border" /> and <span className="h-px flex-1 bg-border" />
                            </div>
                          )}
                          <div
                            className={cn(
                              "rounded-xl border p-3 transition-colors",
                              isActive
                                ? "border-primary/30 bg-primary/4"
                                : "border-border/80",
                            )}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="flex-1 text-[11px] font-medium text-muted-foreground">
                                Group {index + 1} <span className="font-normal">· {group.length > 1 ? "match any" : "required"}</span>
                              </span>
                              <Button
                                aria-label={`Add OR alternative to group ${index + 1}`}
                                aria-pressed={isActive}
                                className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground"
                                disabled={capReached}
                                onClick={() => setOrTargetGroup(isActive ? null : index)}
                                size="xs"
                                type="button"
                                variant={isActive ? "secondary" : "ghost"}
                              >
                                <Plus className="size-3" /> Add OR
                              </Button>
                              <Button
                                aria-label={`Remove group ${index + 1}`}
                                className="-mr-1 size-6 rounded-md p-0 hover:bg-foreground/10"
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
                              {group.map((id, filterIndex) => (
                                <span className="flex items-center gap-1.5" key={id}>
                                  {filterIndex > 0 && (
                                    <span className="text-[9px] font-semibold uppercase text-muted-foreground">or</span>
                                  )}
                                  <Badge className="h-auto max-w-full gap-1 rounded-md bg-secondary/80 py-1 text-[11px] font-normal" variant="secondary">
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

                {orTargetGroup !== null && (
                  <div className="flex items-start justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3" role="status">
                    <p className="text-xs leading-5 text-muted-foreground">
                      Choose one filter below as an <span className="font-medium text-foreground">OR alternative to group {orTargetGroup + 1}</span>. After that, new filters use AND again.
                    </p>
                    <Button
                      className="shrink-0"
                      onClick={() => setOrTargetGroup(null)}
                      size="xs"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                  </div>
                )}

                {ruleSummary && (
                  <p className="sr-only" aria-live="polite">
                    Current rule: {ruleSummary}
                  </p>
                )}

                <details className="group text-[11px] text-muted-foreground">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground"><Info className="size-3.5" /> How do groups work? <ChevronDown className="ml-auto size-3 group-open:rotate-180" /></summary>
                  <p className="mt-2 leading-5">Each new filter creates a required AND group. To allow an alternative, choose Add OR on a group, then select one filter. A match must pass every group; any filter inside an OR group can match.</p>
                </details>

                {capReached && (
                  <p className="rounded-lg bg-secondary p-3 text-xs leading-5 text-muted-foreground" role="status">
                    All {meta.maxFilters} filters are in use. Remove one to try another signal.
                  </p>
                )}

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search filters"
                    className="h-10 border-border/80 bg-background/50 pl-9 text-xs"
                    onChange={(event) => setFilterSearch(event.target.value)}
                    placeholder={`Search ${meta.filterCount} filters…`}
                    value={filterSearch}
                  />
                </div>

                <ScrollArea className="h-[420px] pr-3 lg:h-[480px]">
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
                          <AccordionTrigger className="py-3.5 text-xs font-normal hover:no-underline">
                            <span className="flex items-center gap-2.5">
                              {category}
                              <span className="text-[10px] text-muted-foreground/70">
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
                                    "flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-3 transition-colors hover:bg-muted/60",
                                    selected && "bg-primary/8",
                                    disabled && "cursor-not-allowed opacity-45",
                                  )}
                                  htmlFor={filter.id}
                                  key={filter.id}
                                >
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={selected}
                                    disabled={disabled}
                                    id={filter.id}
                                    onCheckedChange={() => toggleFilter(filter.id)}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 text-xs font-medium leading-4">
                                      {filter.label}
                                    </span>
                                    <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
                                      {filter.description}
                                    </span>
                                  </span>
                                  <span title="Matching games across all indexed history" className="pt-0.5 text-[10px] text-muted-foreground/70">
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

          <section aria-label="Backtest results" className="min-w-0">
            <ResultsPanel
              error={error}
              loading={loading}
              onRetry={() => setRetryToken((token) => token + 1)}
              result={result}
            />
          </section>
        </div>
      </main>

      <footer className="mt-3 border-t border-border/60">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-4 px-4 py-6 text-[11px] leading-5 text-muted-foreground md:px-8">
          <span className="shrink-0">Bet Finder · Historical research · 18+</span>
          <p className="max-w-2xl md:text-right">Historical returns do not predict future results. Testing many combinations can find apparent edges by chance. Data licensing must be confirmed before public launch.</p>
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
