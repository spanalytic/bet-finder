"use client";

import { AlertTriangle, ChevronDown, Info, Loader2, LockKeyhole, SearchX } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BacktestResponse, BreakdownRow } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

interface ResultsPanelProps {
  result: BacktestResponse | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(new Date(`${value}T12:00:00`));
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="min-w-0 p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-[28px] font-medium leading-tight tracking-[-0.045em] tabular-nums",
          tone === "positive" && "text-primary",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

function ProfitCurve({ points }: { points: BacktestResponse["equityCurve"] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-52 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Not enough settled bets to draw a curve.
      </div>
    );
  }

  const width = 920;
  const height = 260;
  const padding = 8;
  const profits = points.map((point) => point.profit);
  const minimum = Math.min(0, ...profits);
  const maximum = Math.max(0, ...profits);
  const range = Math.max(maximum - minimum, 1);
  const x = (index: number) => padding + (index / (points.length - 1)) * (width - padding * 2);
  const y = (profit: number) => padding + ((maximum - profit) / range) * (height - padding * 2);
  const path = points.map((point, index) => `${x(index)},${y(point.profit)}`).join(" ");
  const zeroY = y(0);
  const positive = (points.at(-1)?.profit ?? 0) >= 0;
  const curveColor = positive ? "var(--primary)" : "var(--destructive)";

  return (
    <div className="pt-3">
      <div className="flex gap-4">
      <div className="flex w-12 shrink-0 flex-col justify-between pb-1 text-right text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
        <span>{maximum.toFixed(0)}u</span>
        <span>{((maximum + minimum) / 2).toFixed(0)}u</span>
        <span>{minimum.toFixed(0)}u</span>
      </div>
      <svg
        aria-label="Chronological cumulative profit curve"
        className="h-[240px] min-w-0 flex-1 overflow-visible sm:h-[270px]"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="profit-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={curveColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={curveColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[maximum, (maximum + minimum) / 2, minimum].map((value, index) => (
          <line key={index} stroke="var(--border)" strokeOpacity="0.5" x1={padding} x2={width - padding} y1={y(value)} y2={y(value)} />
        ))}
        <line
          stroke="var(--border)"
          strokeDasharray="5 5"
          strokeWidth="1"
          x1={padding}
          x2={width - padding}
          y1={zeroY}
          y2={zeroY}
        />
        <polygon
          fill="url(#profit-fill)"
          points={`${padding},${zeroY} ${path} ${width - padding},${zeroY}`}
        />
        <polyline
          fill="none"
          points={path}
          stroke={curveColor}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      </div>
      <div className="mt-4 ml-16 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(points.at(-1)?.date ?? points[0].date)}</span>
      </div>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/35">
            <TableHead className="pl-5">Segment</TableHead>
            <TableHead className="text-right">Bets</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">Avg odds</TableHead>
            <TableHead className="text-right">Profit</TableHead>
            <TableHead className="pr-5 text-right">ROI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="py-4 pl-5 font-medium">{row.label}</TableCell>
              <TableCell className="metric-number text-right">{row.bets}</TableCell>
              <TableCell className="metric-number text-right">{row.winRate.toFixed(1)}%</TableCell>
              <TableCell className="metric-number text-right">{row.averageOdds.toFixed(2)}</TableCell>
              <TableCell
                className={cn(
                  "metric-number text-right",
                  row.profit > 0 ? "text-primary" : row.profit < 0 ? "text-destructive" : "",
                )}
              >
                {signed(row.profit, "u")}
              </TableCell>
              <TableCell
                className={cn(
                  "metric-number pr-5 text-right",
                  row.roi > 0 ? "text-primary" : row.roi < 0 ? "text-destructive" : "",
                )}
              >
                {signed(row.roi, "%")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-label="Calculating backtest">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton className="h-28 rounded-xl" key={index} />
        ))}
      </div>
      <Skeleton className="h-[410px] rounded-xl" />
    </div>
  );
}

export function ResultsPanel({ result, loading, error, onRetry }: ResultsPanelProps) {
  if (loading && !result) return <LoadingState />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Backtest unavailable</AlertTitle>
        <AlertDescription>
          <span>{error}</span>
          {onRetry && (
            <Button className="mt-2" onClick={onRetry} size="sm" variant="outline">
              Try again
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  if (!result) return null;

  const { metrics } = result;
  const ruleGroups = result.query.filterGroups.filter((group) => group.length > 0);
  const totalFilters = ruleGroups.reduce((count, group) => count + group.length, 0);
  const baseline = totalFilters === 0;
  const smallSample = metrics.bets < result.query.minBets;
  const confidenceCrossesZero =
    metrics.roiCi !== null && metrics.roiCi[0] <= 0 && metrics.roiCi[1] >= 0;

  if (metrics.bets === 0) {
    return (
      <div className={cn("space-y-5 transition-opacity", loading && "opacity-55")}>
        <Card className="border-dashed bg-card/50 shadow-none">
          <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
            <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SearchX />
            </div>
            <h3 className="text-lg font-medium tracking-tight">No settled bets for this setup</h3>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              {result.qualifyingMatches === 0
                ? "No historical matches qualify. Try removing a filter, or adding more leagues or seasons."
                : "Matches qualify but none have usable odds for this market. Try a different market or widen the selection."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 transition-opacity", loading && "opacity-55")} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Backtest results</h2>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
          {loading ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-primary" />}
          {loading ? "Updating results…" : "Updates automatically"}
        </span>
      </div>
      {baseline && (
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>All matches in your selection. Add a filter to test your strategy.</p>
        </div>
      )}
      {(result.missingOdds > 0 || result.betfairBets > 0) && (
        <div className="rounded-lg border border-border/70 bg-secondary/35 px-3 py-2 text-[11px] leading-5 text-muted-foreground" role="note">
          {result.betfairBets > 0 && <p>{result.betfairBets.toLocaleString()} bets use pre-match Betfair fallback, after {result.query.betfairCommission ?? 5}% commission on winning exchange profit. Other prices are maximum bookmaker odds.</p>}
          {result.missingOdds > 0 && <p>{result.missingOdds.toLocaleString()} qualifying matches have no recorded price for this market and are excluded from returns.</p>}
        </div>
      )}

      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/80 bg-card xl:grid-cols-4 [&>div:nth-child(even)]:border-l [&>div:nth-child(n+3)]:border-t xl:[&>div:nth-child(n+2)]:border-l xl:[&>div:nth-child(n+3)]:border-t-0">
        <MetricCard
          detail="Flat stakes · one unit per bet"
          label="Net profit"
          tone={metrics.profit > 0 ? "positive" : metrics.profit < 0 ? "negative" : "neutral"}
          value={signed(metrics.profit, "u")}
        />
        <MetricCard
          detail="Return on total stakes"
          label="Return on investment"
          tone={metrics.roi > 0 ? "positive" : metrics.roi < 0 ? "negative" : "neutral"}
          value={signed(metrics.roi, "%")}
        />
        <MetricCard
          detail={`${result.qualifyingMatches.toLocaleString()} matches qualified`}
          label="Settled bets"
          value={metrics.bets.toLocaleString()}
        />
        <MetricCard
          detail={`${metrics.wins.toLocaleString()} winning bets`}
          label="Strike rate"
          value={`${metrics.winRate.toFixed(1)}%`}
        />
      </div>

      <Tabs defaultValue="overview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-full overflow-x-auto pb-1">
            <TabsList className="h-9 gap-1 bg-transparent p-0">
              <TabsTrigger className="px-3 text-xs data-[state=active]:bg-secondary!" value="overview">Overview</TabsTrigger>
              <TabsTrigger className="px-3 text-xs data-[state=active]:bg-secondary!" value="seasons">By season</TabsTrigger>
              <TabsTrigger className="px-3 text-xs data-[state=active]:bg-secondary!" value="leagues">By league</TabsTrigger>
              <TabsTrigger className="px-3 text-xs data-[state=active]:bg-secondary!" value="matches">Matches</TabsTrigger>
              <TabsTrigger className="px-3 text-xs data-[state=active]:bg-secondary!" value="holdout">
                <LockKeyhole className="size-3" /> Holdout
              </TabsTrigger>
            </TabsList>
          </div>
          {smallSample && <Badge className="mb-1 text-[10px]" variant="destructive">Small sample · below {result.query.minBets} bets</Badge>}
        </div>

        <TabsContent className="mt-2 space-y-4" value="overview">
          <Card className="gap-5 rounded-2xl border border-border/80 bg-card pt-6 pb-0 shadow-none ring-0">
            <CardHeader className="px-5 sm:px-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-medium">Profit over time</CardTitle>
                  <CardDescription className="mt-1 text-xs">Cumulative returns, settled in match order.</CardDescription>
                </div>
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className={cn("h-0.5 w-4 rounded-full", metrics.profit >= 0 ? "bg-primary" : "bg-destructive")} /> Net profit (units)</span>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-2 sm:px-6">
              <ProfitCurve points={result.equityCurve} />
            </CardContent>
            <div className="grid grid-cols-2 border-t border-border/70 bg-background/20 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-6"><span className="text-muted-foreground">Average odds</span><span className="tabular-nums">{metrics.averageOdds.toFixed(2)}</span></div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-l border-border/70 px-5 py-4 sm:px-6"><span className="text-muted-foreground">Max drawdown</span><span className="tabular-nums">−{metrics.maxDrawdown.toFixed(1)}u</span></div>
            </div>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-border/70 px-4 py-4">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="text-xs leading-5">
              <p className="font-medium">{confidenceCrossesZero ? "The edge is not yet conclusive" : "Understanding this result"}</p>
              <p className="mt-1 text-muted-foreground">{metrics.roiCi
                ? <>Estimated 95% ROI range: <span className="text-foreground">{signed(metrics.roiCi[0], "%")} to {signed(metrics.roiCi[1], "%")}</span>. This measures sampling uncertainty, not future returns.</>
                : "More settled bets are needed to estimate a confidence range."}</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent className="mt-4" value="seasons">
          <BreakdownTable rows={result.bySeason} />
        </TabsContent>

        <TabsContent className="mt-4" value="leagues">
          <BreakdownTable rows={result.byLeague} />
        </TabsContent>

        <TabsContent className="mt-4" value="matches">
          <div className="overflow-x-auto rounded-xl border border-border/80 bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/35">
                  <TableHead>Date</TableHead>
                  <TableHead>League</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Odds</TableHead>
                  <TableHead>Price source</TableHead>
                  <TableHead className="text-right">P/L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.matches.map((match) => (
                  <TableRow key={`${match.id}-${match.date}`}>
                    <TableCell className="metric-number text-xs text-muted-foreground">
                      {shortDate(match.date)}
                    </TableCell>
                    <TableCell className="text-xs">{match.league}</TableCell>
                    <TableCell>
                      <div className="font-medium">{match.home} <span className="font-normal text-muted-foreground">v</span> {match.away}</div>
                      {match.matchedFilters.length > 0 && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Matched {match.matchedFilters.length} selected filter{match.matchedFilters.length === 1 ? "" : "s"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="metric-number text-center">{match.score}</TableCell>
                    <TableCell className="metric-number text-right">{match.odds.toFixed(2)}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{match.oddsType === "betfair" ? `Betfair · ${match.priceMinute}m` : "Bookmaker max"}</TableCell>
                    <TableCell
                      className={cn(
                        "metric-number text-right",
                        match.won ? "text-primary" : "text-destructive",
                      )}
                    >
                      {signed(match.profit, "u")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Showing the 100 most recent qualifying bets.</p>
        </TabsContent>

        <TabsContent className="mt-4" value="holdout">
          <Card className="border-dashed bg-card/50 shadow-none">
            <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
              <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LockKeyhole />
              </div>
              <h3 className="text-lg font-medium tracking-tight">Out-of-sample testing</h3>
              <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                A future premium mode will build on earlier seasons and reveal the untouched holdout season only after the strategy is locked.
              </p>
              <Badge className="mt-4" variant="outline">Premium roadmap</Badge>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <details className="group border-t border-border/70 pt-4 text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
          <span>{result.qualifyingMatches.toLocaleString()} of {result.poolMatches.toLocaleString()} matches qualify <span className="mx-1 text-border">·</span> Data & methodology</span>
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-1.5 leading-5">
          <p>{totalFilters} selected filter{totalFilters === 1 ? "" : "s"} across {ruleGroups.length} group{ruleGroups.length === 1 ? "" : "s"}. Groups use AND; filters within each group use OR.</p>
          <p>{result.missingOdds.toLocaleString()} qualifying matches excluded for missing market odds.{result.enrichmentCoverage !== null && ` Event-data coverage: ${result.enrichmentCoverage}%.`}</p>
          <p>One-unit stakes. Maximum closing bookmaker odds preferred, opening maximum fallback if needed. Betfair uses the last recorded price in the 10 minutes strictly before kickoff; {result.query.betfairCommission ?? 5}% commission on winning exchange profit. No in-play or prediction-market odds.</p>
          <p>Only validated detailed-event fixtures are included. Weather and player market values remain optional. Rolling windows and previous-match comparisons are unavailable across known event-data gaps, not extended to older games. Fixtures missing from all sources remain a limitation. Early fixtures cannot match filters needing missing history. An absent feature is not a negative signal. Available prices may have been lower in practice. Trying many combinations can produce attractive results by chance.</p>
        </div>
      </details>
    </div>
  );
}
