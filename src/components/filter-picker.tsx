"use client";

import { useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FilterDefinition } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

interface FilterPickerProps {
  categories: Array<[string, FilterDefinition[]]>;
  selected: string[];
  counts: Map<string, number> | null;
  capReached: boolean;
  minimum: number;
  onToggle: (id: string) => void;
}

export function FilterPicker({ categories, selected, counts, capReached, minimum, onToggle }: FilterPickerProps) {
  const [category, setCategory] = useState("all");
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const activeCategory = categories.some(([name]) => name === category) ? category : "all";
  const visible = activeCategory === "all" ? categories : categories.filter(([name]) => name === activeCategory);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Counts show matches with odds in your chosen leagues, seasons and market, before combining filters. Zero-match filters are unavailable in this scope.</p>
        <Select onValueChange={setCategory} value={activeCategory}>
          <SelectTrigger aria-label="Filter category" className="h-10 w-full bg-background sm:w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(([name]) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {visible.length ? (
        <div className="columns-1 gap-5 lg:columns-2 2xl:columns-3">
          {visible.map(([name, filters]) => (
            <section aria-label={name} className="mb-5 break-inside-avoid overflow-hidden rounded-xl border border-border/80 bg-background/30" key={name}>
              <div className="flex items-center justify-between gap-3 border-b bg-secondary/35 px-4 py-3.5">
                <h3 className="text-base font-semibold tracking-tight">{name}</h3>
                <span className="text-xs text-muted-foreground">{filters.length} filters</span>
              </div>
              <div className="divide-y divide-border/60">
                {filters.map((filter) => {
                  const checked = selectedIds.has(filter.id);
                  const count = counts ? (counts.get(filter.id) ?? 0) : null;
                  const disabled = !checked && (capReached || count === 0);
                  return (
                    <label className={cn("flex min-h-24 cursor-pointer items-start gap-3 px-4 py-4 transition-colors hover:bg-secondary/45", checked && "bg-primary/8", disabled && "cursor-not-allowed opacity-50")} htmlFor={filter.id} key={filter.id}>
                      <Checkbox aria-label={filter.label} checked={checked} className="mt-0.5 size-5" disabled={disabled} id={filter.id} onCheckedChange={() => onToggle(filter.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-5">{filter.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{filter.description}</span>
                        {count === 0 && <span className="mt-1 block text-xs text-muted-foreground">No selections in this scope</span>}
                      </span>
                      <span className="shrink-0 rounded-md bg-secondary/70 px-2 py-1 text-right text-xs tabular-nums" title="Usable matches in the current market, leagues and seasons. This is not the combined strategy count.">
                        <span className="block font-semibold">{count === null ? "…" : count.toLocaleString()}</span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">matches</span>
                        {count !== null && count > 0 && count < minimum && <span className="mt-1 block text-[10px] text-muted-foreground">Small sample</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : <p className="py-12 text-center text-sm text-muted-foreground">No filters match that search.</p>}
    </div>
  );
}
