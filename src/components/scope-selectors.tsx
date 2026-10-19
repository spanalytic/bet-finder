"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CompetitionCoverage, IndexMeta, MarketId } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

interface SelectionProps {
  selected: string[];
  onChange: (selection: string[]) => void;
}

function toggleSelection(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? (selected.length > 1 ? selected.filter((item) => item !== value) : selected)
    : [...selected, value];
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

const TOP_FIVE = new Set(["E0", "D1", "F1", "SP1", "I1"]);

export function CompetitionSelector({ competitions, market, selected, onChange }: SelectionProps & {
  competitions: CompetitionCoverage[];
  market: MarketId;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visible = useMemo(() => competitions.filter((item) =>
    `${item.name} ${item.country} ${item.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  ), [competitions, search]);
  const selectedDomestic = competitions.filter((item) => item.kind === "domestic" && selected.includes(item.name)).length;
  const selectedUefa = selected.length - selectedDomestic;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button aria-label="Choose competitions" className="h-10 w-full justify-between bg-background/50 text-xs" variant="outline">
          <span>{selected.length === competitions.filter((item) => item.matches > 0).length ? "All available competitions" : `${selected.length} competitions selected`}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <p className="text-[11px] text-muted-foreground">{selectedDomestic} domestic · {selectedUefa} UEFA · <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setOpen(true)} type="button">View coverage</button></p>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader className="pr-7">
          <DialogTitle>Choose competitions</DialogTitle>
          <DialogDescription>Only matches with validated detailed events are available. Leagues without qualifying records are disabled. Weather, player values and rolling-history coverage can still vary.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input aria-label="Search competitions" className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search by league, country or UCL / UEL / UECL…" value={search} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onChange(competitions.filter((item) => item.matches > 0).map((item) => item.name))} size="xs" variant="outline">Select all available</Button>
          <Button onClick={() => onChange(competitions.filter((item) => item.matches > 0 && TOP_FIVE.has(item.code)).map((item) => item.name))} size="xs" variant="outline">Top five only</Button>
          <Button onClick={() => onChange(competitions.filter((item) => item.matches > 0 && item.kind === "domestic").map((item) => item.name))} size="xs" variant="outline">Domestic only</Button>
          <Button onClick={() => onChange(competitions.filter((item) => item.matches > 0 && item.kind === "uefa").map((item) => item.name))} size="xs" variant="outline">UEFA only</Button>
          <span className="ml-auto text-xs text-muted-foreground" role="status">{selected.length} selected</span>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {(["domestic", "uefa"] as const).map((kind) => {
            const rows = visible.filter((item) => item.kind === kind);
            if (!rows.length) return null;
            return (
              <section aria-label={kind === "domestic" ? "Domestic leagues" : "UEFA competitions"} key={kind}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{kind === "domestic" ? "Domestic leagues" : "UEFA competitions"}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {rows.map((item) => {
                    const checked = selected.includes(item.name);
                    const priced = item.markets[market];
                    return (
                      <div className={cn("rounded-xl border transition-colors hover:bg-secondary/40", checked && "border-primary/25 bg-primary/5")} key={item.code}>
                        <label className={cn("flex items-start gap-3 p-3", item.matches ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
                        <Checkbox aria-label={item.name} checked={checked} disabled={!item.matches} className="mt-0.5" onCheckedChange={() => onChange(toggleSelection(selected, item.name))} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium">{item.name}{kind === "uefa" && <span className="ml-1.5 text-[10px] text-muted-foreground">{item.code}</span>}</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.country} · {item.matches.toLocaleString()} detailed-event matches</span>
                          <span className={cn("mt-1 block text-[11px]", priced ? "text-primary" : "text-muted-foreground")}>{priced ? `${priced.toLocaleString()} with market odds` : "No recorded odds for this market"}{item.betfairMarkets[market] > 0 && ` · ${item.betfairMarkets[market].toLocaleString()} Betfair`}</span>
                          <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">{item.matches ? `${(item.matches / item.sourceMatches * 100).toFixed(1)}% of known source fixtures pass event checks` : "Unavailable · no complete event records"}{item.marketLastDates[market] && ` · Prices to ${displayDate(item.marketLastDates[market])}`}</span>
                        </span>
                        </label>
                        <details className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                          <summary className="cursor-pointer text-[11px] font-medium">Filter input coverage · {item.name}</summary>
                          <p className="mt-2 leading-4">{item.incompleteEventMatches.toLocaleString()} incomplete event records and {item.missingEventMatches.toLocaleString()} fixtures without event records are excluded. Input percentages below refer only to eligible matches, not filter hits. Rolling inputs still need prior games.</p>
                          <dl className="mt-2 space-y-1.5">{Object.entries(item.featureCounts).map(([feature, count]) => <div className="flex justify-between gap-3" key={feature}><dt>{feature}</dt><dd className="shrink-0 tabular-nums">{count ? `${(count / item.matches * 100).toFixed(1)}%` : "Unavailable"}</dd></div>)}</dl>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!visible.length && <p className="py-6 text-center text-sm text-muted-foreground">No competitions match your search.</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <p className="max-w-lg text-[11px] leading-4 text-muted-foreground">Coverage varies by field, season and market. Percentages refer to indexed matches, not an independent audit of all scheduled fixtures. Unpriced matches do not contribute to returns.</p>
          <Button onClick={() => setOpen(false)} size="sm">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SeasonSelector({ meta, selected, onChange }: SelectionProps & { meta: IndexMeta }) {
  const [open, setOpen] = useState(false);
  const currentSelected = selected.includes(meta.currentSeason);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button aria-label="Choose seasons" className="h-10 w-full justify-between bg-background/50 text-xs" variant="outline">
          <span>{selected.length} of {meta.availableSeasons.length} seasons selected</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <p className="text-[11px] text-muted-foreground">{currentSelected ? "2026/27 included through the cutoff" : "2026/27 available · explicit opt-in"}</p>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose seasons</DialogTitle>
          <DialogDescription>Use seasons from 2022/23 onwards only. Current-season matches are included only when you select 2026/27.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onChange(meta.defaultSeasons)} size="xs" variant="outline">All completed seasons</Button>
          <Button onClick={() => onChange(meta.availableSeasons)} size="xs" variant="outline">All including 2026/27</Button>
        </div>
        <div className="grid gap-2 overflow-y-auto sm:grid-cols-2">
          {meta.availableSeasons.map((season) => (
            <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-xs", selected.includes(season) && "border-primary/25 bg-primary/5")} key={season}>
              <Checkbox aria-label={season.replace("-", "/")} checked={selected.includes(season)} onCheckedChange={() => onChange(toggleSelection(selected, season))} />
              <span className="flex-1">{season.replace("-", "/")}{season === meta.currentSeason && <span className="ml-1 text-[10px] text-primary">Current</span>}</span>
              <span className="text-[10px] text-muted-foreground">{meta.seasonCounts[season].toLocaleString()}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">Calendar-year leagues (for example MLS 2026) appear in the bucket starting in that year (2026/27). Coverage differs between competitions. No matches after {displayDate(meta.cutoffDate)} are included.</p>
        <Button className="self-end" onClick={() => setOpen(false)} size="sm">Done</Button>
      </DialogContent>
    </Dialog>
  );
}
