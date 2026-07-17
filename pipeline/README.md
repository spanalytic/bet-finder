# Bet Finder data index

The website reads `data/backtest-index.json` and never accesses the source football project at runtime.

Rebuild the index weekly from the repository root:

```powershell
C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe pipeline\build_index.py
```

The builder uses the historical season archives for history and treats the larger `PyCharmMiscProject/Odds` directory as authoritative for overlapping 2025-26 matches. It then computes rolling features and atomic filter membership once, producing a compact runtime index.

The adapter currently calls the proven feature functions in the source project during the weekly build. Its JSON output contract deliberately isolates this dependency so those functions can be migrated into this repository category-by-category without changing the website.
