# Bet Finder

A desktop-first website for building and backtesting pre-match football betting strategies.

Live website: [Bet Finder](https://spanalytic.github.io/bet-finder/).

## Included in the first draft

- Top-five leagues: EPL, Bundesliga, Ligue 1, La Liga and Serie A.
- 125 fixed filters across 16 categories.
- Filters combine with AND by default, with a five-filter cap. Use Add OR on a group to add one alternative; subsequent selections return to AND. Saved strategies retain their existing group rules.
- Home, draw, away, Over 2.5 and Under 2.5 markets.
- Maximum closing odds, one-unit flat staking and no commission.
- ROI, profit, strike rate, average odds, maximum drawdown and 95% confidence intervals.
- Season and league breakdowns, cumulative profit curve and recent qualifying matches.
- Browser-local named strategy saving.
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
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\build_index.py
```

The website reads `data/backtest-index.json` and does not access `PyCharmMiscProject` at runtime. See `pipeline/README.md` for the current migration boundary. After rebuilding, commit the updated `data/backtest-index.json` and push to redeploy the live site.

## Deployment (GitHub Pages)

The site is a fully static export (`output: "export"`): the browser downloads `backtest-index.json` once and runs every backtest locally, so no server is needed. `.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`. In the repository settings, set **Pages → Source → GitHub Actions** once.

## Verification

```powershell
npm run lint
npm run build
```

## Important limitations

- Historical performance is not a prediction or guarantee.
- Maximum closing odds can overstate prices a bettor could consistently obtain.
- Trying many filters increases the likelihood of finding an apparently profitable result by chance.
- Confidence intervals describe sampling uncertainty but do not solve strategy-selection bias.
- Data redistribution and source licensing must be confirmed before public deployment.
- Saved strategies currently live in the local browser; public accounts and subscriptions require a database and authentication in a later phase.
