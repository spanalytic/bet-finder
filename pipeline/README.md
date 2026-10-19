# Bet Finder data index

The website reads `data/backtest-index.json` and never accesses the source football project at runtime.

Rebuild the index weekly from the repository root:

```powershell
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\refresh_odds.py
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\build_index.py --through 2026-10-01
```

The catalogue includes all 30 domestic leagues with odds or event coverage and UCL, UEL and UECL. National teams, domestic cups and non-UEFA continental cups remain outside scope. CSV-only lower divisions are labelled as basic-form coverage.

The builder reads historical season archives and standalone CSV history, retaining only season buckets 2022-2023 onwards before calculating rolling features. Precedence is archives → legacy `Odds` loose files → `data/Odds` loose files → refreshed workspace snapshots. Refresh downloads only public CSVs to ignored `data/sources`; it never modifies the football project. Failed downloads preserve any previous snapshot and are recorded in `refresh-report.json`.

Only completed, scored fixtures dated on or before `--through` are retained. Early-season fixtures remain in the pool, even without five prior games. Rolling form is competition- and season-specific. Calendar seasons use the bucket beginning in that year (MLS 2026 → 2026-2027). Current-season buckets remain opt-in on the website.

Bookmaker maximum closing prices take precedence, with opening maximum fallback where available. If a market has no bookmaker price, the last valid Betfair decimal snapshot in [-10, 0) minutes is used. Minute zero, in-play, stale and Polymarket prices are excluded. Commission is applied by the browser to winning exchange profit using the selected assumption (5% initially). Generic event `odds_home_win` fields are not presumed to be maximum bookmaker prices.

The event archives mix provider ID namespaces. The adapter uses documented name aliases and unique fixture links anchored by a known team, competition, date and identical score; no fuzzy name matching is used. Calendar leagues permit a one-day UTC/local drift only for a unique fixture link. Canonical name identities avoid cross-provider Elo collisions. Event-only matches contribute prior history even when they have no price. UEFA exchange settlement reconstructs regulation scores from validated cumulative goal events when extra time changed the final score; uncertain regulation scores do not receive exchange fallback.

The existing 125-filter candidate catalogue is pinned in `filter_ids.json`; changes to the upstream screener do not silently introduce new filters. Source feature functions are run once at build time. `filter_quality.py` then retains only filters with at least 100 distinct matching fixtures that have at least one usable market price across all supported leagues and seasons. Multiple priced markets on one fixture count only once. No ROI or performance ranking is used. The current index has 120 active filters and five retired filters, with their counts and reasons retained in metadata. Schema v2 uses numeric filter ordinals remapped to the active catalogue to reduce the download; existing saved strategy IDs and AND/OR semantics are unchanged. Old saved rules containing retired IDs require explicit removal before they can run, rather than silently losing a condition.

Competition metadata reports match counts, event-file coverage, market price counts, Betfair counts and latest priced match dates. `featureCounts` separately reports conservative pre-match input availability for goals, shots, xG, Elo, XI value, lineup changes, formation, duels, weather and rest. These percentages describe indexed matches and include normal rolling-history warm-up gaps; they are neither individual filter hit rates nor an independent reconciliation of every scheduled fixture. Ten competitions currently have only odds/basic-form coverage, and an event file does not guarantee that every field is present. The requested cutoff must not be presented as proof of complete coverage in every source. Missing prices are excluded from returns and surfaced in results.

The browser shows a separate, full-width filter-selection step before results. Filter-card counts are recalculated for the chosen market, leagues and seasons before rule combinations. A globally retained filter may have fewer than 100 matches in a narrower scope; positive small samples are labelled and zero-match options are disabled unless already selected.

The adapter currently calls the proven feature functions in the source project during the weekly build. Its JSON output contract deliberately isolates this dependency so those functions can be migrated into this repository category-by-category without changing the website.
