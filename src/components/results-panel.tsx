"use client";

import { AlertTriangle, Database, Info, Loader2, LockKeyhole, SearchX, TrendingDown, TrendingUp } from "lucide-react";

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
    <Card className="gap-3 border-border/80 bg-card/80 py-4 shadow-none">
      <CardHeader className="px-4">
        <CardDescription className="text-[11px] font-medium uppercase tracking-[0.12em]">
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "metric-number text-2xl font-medium tracking-[-0.04em]",
            tone === "positive" && "text-primary",
            tone === "negative" && "text-destructive",
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{detail}</CardContent>
    </Card>
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
  const height = 220;
  const padding = 18;
  const profits = points.map((point) => point.profit);
  const minimum = Math.min(0, ...profits);
  const maximum = Math.max(0, ...profits);
  const range = Math.max(maximum - minimum, 1);
  const x = (index: number) => padding + (index / (points.length - 1)) * (width - padding * 2);
  const y = (profit: number) => padding + ((maximum - profit) / range) * (height - padding * 2);
  const path = points.map((point, index) => `${x(index)},${y(point.profit)}`).join(" ");
  const zeroY = y(0);

  return (
    <div>
      <svg
        aria-label="Chronological cumulative profit curve"
        className="h-52 w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="profit-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
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
          stroke="var(--primary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.4"
        />
      </svg>
      <div className="metric-number flex justify-between text-[11px] text-muted-foreground">
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(points.at(-1)?.date ?? points[0].date)}</span>
      </div>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/35">
            <TableHead>Segment</TableHead>
            <TableHead className="text-right">Bets</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">Avg odds</TableHead>
            <TableHead className="text-right">Profit</TableHead>
            <TableHead className="text-right">ROI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium">{row.label}</TableCell>
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
                  "metric-number text-right",
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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
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
    <div className={cn("space-y-5 transition-opacity", loading && "opacity-55")}>
      {baseline && (
        <Alert>
          <Info />
          <AlertTitle>Whole-market baseline</AlertTitle>
          <AlertDescription>
            No filters are selected, so this shows every match in the chosen leagues and seasons. Pick one or two filters on the left to test a strategy against this baseline.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          detail={`${result.qualifyingMatches.toLocaleString()} matches passed the screen`}
          label="Settled bets"
          value={metrics.bets.toLocaleString()}
        />
        <MetricCard
          detail={`${metrics.wins.toLocaleString()} winning bets`}
          label="Strike rate"
          value={`${metrics.winRate.toFixed(1)}%`}
        />
        <MetricCard
          detail={metrics.roiCi ? `95% CI ${signed(metrics.roiCi[0], "%")} to ${signed(metrics.roiCi[1], "%")}` : "Insufficient sample"}
          label="ROI"
          tone={metrics.roi > 0 ? "positive" : metrics.roi < 0 ? "negative" : "neutral"}
          value={signed(metrics.roi, "%")}
        />
        <MetricCard
          detail="At one unit per settled bet"
          label="Net profit"
          tone={metrics.profit > 0 ? "positive" : metrics.profit < 0 ? "negative" : "neutral"}
          value={signed(metrics.profit, "u")}
        />
        <MetricCard
          detail="Maximum closing price"
          label="Average odds"
          value={metrics.averageOdds.toFixed(2)}
        />
        <MetricCard
          detail="Peak-to-trough, chronological"
          label="Max drawdown"
          tone={metrics.maxDrawdown > 0 ? "negative" : "neutral"}
          value={`−${metrics.maxDrawdown.toFixed(1)}u`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {loading && (
          <Badge className="gap-1.5" variant="outline">
            <Loader2 className="size-3 animate-spin" /> Updating…
          </Badge>
        )}
        <Badge variant="outline">
          {result.qualifyingMatches.toLocaleString()} of {result.poolMatches.toLocaleString()} matches
        </Badge>
        {!baseline && (
          <Badge variant="outline">
            {totalFilters} filter{totalFilters === 1 ? "" : "s"} in {ruleGroups.length} group{ruleGroups.length === 1 ? "" : "s"}
          </Badge>
        )}
        {result.missingOdds > 0 && (
          <Badge variant="secondary">{result.missingOdds} missing market prices</Badge>
        )}
        {result.enrichmentCoverage !== null && (
          <Badge variant="secondary">
            <Database data-icon="inline-start" />
            {result.enrichmentCoverage}% event-data coverage
          </Badge>
        )}
        {smallSample && <Badge variant="destructive">Below {result.query.minBets} bet minimum</Badge>}
      </div>

      <Tabs defaultValue="overview">
        <div className="overflow-x-auto pb-1.5">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="seasons">By season</TabsTrigger>
            <TabsTrigger value="leagues">By league</TabsTrigger>
            <TabsTrigger value="matches">Qualifying matches</TabsTrigger>
            <TabsTrigger value="holdout">
              <LockKeyhole data-icon="inline-start" /> Holdout
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="mt-4 space-y-4" value="overview">
          <Card className="border-border/80 bg-card/70 shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-6">
                <div>
                  <CardTitle className="text-lg font-medium tracking-tight">Cumulative one-unit profit</CardTitle>
                  <CardDescription>Settled chronologically across the selected competitions.</CardDescription>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    metrics.profit >= 0 ? "text-primary" : "text-destructive",
                  )}
                >
                  {metrics.profit >= 0 ? <TrendingUp /> : <TrendingDown />}
                  {signed(metrics.profit, " units")}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ProfitCurve points={result.equityCurve} />
            </CardContent>
          </Card>

          <Alert>
            <Info />
            <AlertTitle>{confidenceCrossesZero ? "The edge is not yet conclusive" : "Confidence range"}</AlertTitle>
            <AlertDescription>
              {metrics.roiCi
                ? `The estimated 95% ROI interval is ${signed(metrics.roiCi[0], "%")} to ${signed(metrics.roiCi[1], "%")}. This describes sampling uncertainty, not a guarantee of future returns.`
                : "Add more settled bets before treating the result as evidence of an edge."}
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent className="mt-4" value="seasons">
          <BreakdownTable rows={result.bySeason} />
        </TabsContent>

        <TabsContent className="mt-4" value="leagues">
          <BreakdownTable rows={result.byLeague} />
        </TabsContent>

        <TabsContent className="mt-4" value="matches">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/35">
                  <TableHead>Date</TableHead>
                  <TableHead>League</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-right">Odds</TableHead>
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
    </div>
  );
}
