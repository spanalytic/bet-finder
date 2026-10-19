# Bet Finder

A desktop-first website for building and backtesting pre-match football betting strategies.

Live website: [Bet Finder](https://spanalytic.github.io/bet-finder/).

## Included in the first draft

- All 30 domestic leagues with CSV or event coverage, plus Champions League, Europa League and Conference League.
- Seasons 2022/23 onwards, with an inclusive match-date cutoff of 1 October 2026. Coverage is shown by competition, market and feature input; this is not a guarantee of complete records for every competition.
- 120 available filters across 16 categories. The fixed 125-filter candidate catalogue is screened for at least 100 distinct matches with usable odds across the supported history; five low-sample filters are retired in the current index. This is a sample-size gate, not a profitability ranking.
- A full-width, searchable filter library with larger options and match counts for the chosen leagues, seasons and market. Choose filters first, then open the separate results view; Edit filters preserves the setup.
- Filters combine with AND by default, with a five-filter cap. Use Add OR on a group to add one alternative; subsequent selections return to AND. Saved strategies retain their existing group rules.
- Home, draw, away, Over 2.5 and Under 2.5 markets.
- Maximum closing bookmaker odds preferred (opening maximum fallback). Missing markets can use the last recorded Betfair price strictly before kickoff, no more than 10 minutes old. Price sources are labelled; exchange commission starts at an editable 5% assumption, applied only to winning exchange profit. One-unit flat staking.
- ROI, profit, strike rate, average odds, maximum drawdown and 95% confidence intervals.
- Season and league breakdowns, cumulative profit curve and recent qualifying matches.
- Browser-local named strategy saving. Retired filters in old saved rules remain visible and block results until explicitly removed, so a saved strategy cannot silently become broader.
- Light and dark themes, with light as the default and your choice remembered in this browser.
- Completed seasons selected by default; the current season is explicit opt-in.

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

## Deployment (GitHub Pages)

The site is a fully static export (`output: "export"`): the browser downloads `backtest-index.json` once and runs every backtest locally, so no server is needed. `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source → GitHub Actions** once.

## Verification

```powershell
npx eslint src
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe -m unittest discover -s pipeline -p test_pipeline.py
node pipeline/test_backtest.cjs
npm run build
```

## Important limitations

- Historical performance is not a prediction or guarantee.
- Maximum closing odds can overstate prices a bettor could consistently obtain.
- Betfair fallback records may be sparse. The editable commission assumption is not a claim about the rate for a particular account; spreads, slippage, liquidity and market netting are not modelled.
- Missing event data and short rolling history do not mean a filter is false in the real world; they mean it cannot be confirmed by this index. Ten odds/basic-form-only leagues do not support event-dependent filters. Event files can also have missing xG, lineup-value, weather or other fields; the competition coverage panel shows input availability separately from event-file coverage.
- The 100-match catalogue threshold is global. A selected market, league, season or combination of filters may still have a much smaller sample; zero-match filters are disabled in that scope and smaller positive samples are labelled.
- Trying many filters increases the likelihood of finding an apparently profitable result by chance.
- Confidence intervals describe sampling uncertainty but do not solve strategy-selection bias.
- Data redistribution and source licensing must be confirmed before public deployment.
- Saved strategies currently live in the local browser; public accounts and subscriptions require a database and authentication in a later phase.
