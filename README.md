# Bet Finder

A desktop-first website for building and backtesting pre-match football betting strategies.

Live website: [Bet Finder](https://spanalytic.github.io/bet-finder/).

## Included in the first draft

- A catalogue of 30 domestic leagues plus Champions League, Europa League and Conference League. Only competitions with validated detailed event records can be selected; unsupported competitions remain visible as unavailable.
- Seasons 2022/23 onwards, with an inclusive match-date cutoff of 1 October 2026. Coverage is shown by competition, market and feature input; this is not a guarantee of complete records for every competition.
- A fixed 125-filter candidate catalogue across 16 categories, screened for at least 100 distinct matches with usable odds across the supported history. Active and retired filter counts update on every rebuild and are shown in the library. This is a sample-size gate, not a profitability ranking.
- A full-width, searchable filter library with larger options and match counts for the chosen leagues, seasons and market. Choose filters first, then open the separate results view; Edit filters preserves the setup.
- Filters combine with AND by default, with a five-filter cap. Use Add OR on a group to add one alternative; subsequent selections return to AND. Saved strategies retain their existing group rules.
- Home, draw, away, Over 2.5 and Under 2.5 markets.
- Maximum closing bookmaker odds preferred (opening maximum fallback). Missing markets can use the last recorded Betfair price strictly before kickoff, no more than 10 minutes old. Price sources are labelled; exchange commission starts at an editable 5% assumption, applied only to winning exchange profit. One-unit flat staking.
- ROI, profit, strike rate, average odds, maximum drawdown and 95% confidence intervals.
- Season and league breakdowns, cumulative profit curve and recent qualifying matches.
- Browser-local named strategy saving. Retired filters in old saved rules remain visible and block results until explicitly removed, so a saved strategy cannot silently become broader.
- Light and dark themes, with light as the default and your choice remembered in this browser.
- Completed seasons selected by default; the current season is explicit opt-in.
- Detailed events only: every indexed match must have both starting XIs/formations, core statistics including xG, a reconciled event timeline and a detailed, reconciled shot map. Score-only, odds-only and incomplete-event fixtures are excluded before rolling statistics and Elo are calculated. Weather and player market values remain optional.

## Run locally

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To build the production website:

```powershell
npm run build
```

The build writes static files to `out/`; GitHub Pages serves these files for the live website.

## Rebuild the data weekly

```powershell
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\refresh_odds.py
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\build_index.py --through 2026-10-01
```

The website reads `data/backtest-index.json` and does not access `PyCharmMiscProject` at runtime. See `pipeline/README.md` for the current migration boundary. After rebuilding, commit the updated `data/backtest-index.json` and push to redeploy the live site.

## Audit and backfill event details

The read-only event audit is `pipeline/audit_events.py`. With provider-approved access only, `pipeline/backfill_events.py --approved-access --pilot 3` checks historical FotMob support across league/season combinations. Omitting `--pilot` runs a resumable gap backfill. Use `--max-details` to bound a run. The collector is single-request, rate-limited, and stops on access/rate-limit errors rather than attempting a bypass.

Validated downloads are kept in ignored `data/sources/events/<competition>/<season>/`; no source-project files are overwritten. Incomplete responses are logged and never promoted to event coverage. The index builder also reads the alternate local EPL FotMob archive, preferring complete records over incomplete duplicates. Rebuild and deploy after a backfill to update the public site.

The completed October 2026 backfill release contains 36,605 validated unique fixtures across 29 available competitions, up 15,291 from the initial detailed-events-only release. All 120 active filters meet the global 100-priced-match threshold. See [the coverage report](pipeline/BACKFILL_2026-10-01.md) for competition counts and remaining gaps; this is not complete all-fixture coverage.

## Deployment (GitHub Pages)

The site is a fully static export (`output: "export"`): the browser downloads `backtest-index.json` once and runs every backtest locally, so no server is needed. `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source → GitHub Actions** once.

## Verification

```powershell
npx eslint src
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe -m unittest discover -s pipeline -p 'test_*.py'
node pipeline/test_backtest.cjs
npm run build
```

## Important limitations

- Historical performance is not a prediction or guarantee.
- Maximum closing odds can overstate prices a bettor could consistently obtain.
- Betfair fallback records may be sparse. The editable commission assumption is not a claim about the rate for a particular account; spreads, slippage, liquidity and market netting are not modelled.
- Passing the detailed-event checks does not prove that every historical fixture is present. Rolling windows and previous-match comparisons are unavailable across known event-data gaps; they do not silently skip to older available games. Elo uses the unique eligible history, and fixtures absent from all sources remain a limitation. Weather and lineup-value fields may still be missing; the coverage panel shows this separately. Missing inputs do not mean a real-world filter condition is false; they mean it cannot be confirmed by the index.
- The 100-match catalogue threshold is global. A selected market, league, season or combination of filters may still have a much smaller sample; zero-match filters are disabled in that scope and smaller positive samples are labelled.
- Trying many filters increases the likelihood of finding an apparently profitable result by chance.
- Confidence intervals describe sampling uncertainty but do not solve strategy-selection bias.
- Use collectors only under provider-approved access and within the applicable licence, rate limits and redistribution permissions. FotMob backfill was enabled only after the user confirmed approved access; credentials are never published.
- Saved strategies currently live in the local browser; public accounts and subscriptions require a database and authentication in a later phase.
