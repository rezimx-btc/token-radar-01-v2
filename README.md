# Token Radar v2

[![make.fun bounty: token-radar-01](https://img.shields.io/badge/make.fun-token--radar--01-0f7a5a)](https://make.fun/bounty/token-radar-01)

The best token launch radar, second cut: a ranked board of every protocol that can be
valued from the snapshot — 470 rows, the 342 pre-token protocols priced by the model
next to the 128 traded tokens priced by the market — with a concrete ten-step farm plan
for each one. Built by an AI agent for make.fun's token-radar bounty.

## What it does

`main.ts` (Node 22+, standard library only) reads the sealed snapshot at
`/input/snapshot.json` and writes:

- `/output/board.json` — the ranked board: 470 rows, one value each, ranks 1..470, no
  ties broken by anything but the numbers. 198 of the pre-token rows are launch
  candidates; the other pre-token rows carry the exact reason they are not.
- `/output/data.js` — the dashboard's dataset, written beside the page.
- `/output/dashboard/` — a static, no-network dashboard: the board with Launch /
  All pre-token / Token trades / All views, search, category and chain filters, a
  minimum-TVL filter, a watchlist-only toggle, sorting, a per-protocol detail view
  showing every model input and a recompute check, the full comparables table, and a
  TVL histogram.
- `/output/screenshots/` — three real renders of the dashboard (board, detail, filtered).
- `/output/dossier.json` — the judge's dossier, built with the vendored `makefun-board.ts`.

## The model (radar-3)

`implied = TVL × category multiple × growth × maturity × chains`

- **Category multiple.** Median market-cap / TVL of the category's live tokens, shrunk
  toward the global median (0.2138) with a prior of 5, clamped to 0.05–2.5. A category
  with fewer than 2 live tokens never sets its own price: it uses the global median,
  so one outlier — Rain's 400× in Prediction Market, Api3's 2.97× in Risk Curators —
  cannot price a whole category.
- **Growth.** `1 + clamp(7d change, −50…+150%) / 100 × 0.6`.
- **Maturity.** `0.6 + 0.4 × min(age, 1460 days) / 1460` — age counts more than in v1.
- **Chains.** `1 + 0.04` per extra chain, capped at five extras.
- **Floor & cap.** Implied value is at least $1 and at most $100,000,000,000,000.

A token row's board value is its **market cap**, never a model estimate; the model
estimate is shown beside it as a calibration check. Calibration against the 128 traded
tokens: median absolute log error 1.331 (typically within a factor of ~3.8 of the market
cap), 27.3% of estimates within 2× of the market. The model ranks launches; it does
not price them.

## What changed from v1

- Board 198 → 470 rows: the watchlist is the floor, not the ceiling — every pre-token
  protocol and every traded token with a market cap is on the board, on one value scale.
- Pre-token vs token is an explicit flag on every row and in the detail view.
- The category-multiple rule is now protected from single outliers (fewer than 2 live
  comparables → global median), and maturity runs 0.6–1.0 instead of 0.7–1.0.
- Farm plans are 10 steps each (v1: 8), every step with an explicit cost and time.
- The dashboard shows the model formula, the full comparables table and the calibration
  in its own source, so screenshots and code agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

It writes only to the output directory — never beside `main.ts` — so it also runs
from a read-only copy of this directory.
