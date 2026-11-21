[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/rezimx-btc/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/rezimx-btc/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01)

# Launch Radar v2 — the best token launch radar

Which pre-token protocol is worth farming next, and what do I do about it?

This entry reads a sealed DefiLlama snapshot (758 protocols, frozen 2026-11-14), fits a launch-value
model from the traded protocols' own record, and ranks every rankable pre-token protocol by the
expected value of its launch — with a costed farm plan and a FARM / THIN / SKIP verdict for each one.

## The model (fitted, not asserted)

- **Launch value:** `exp(6.964567 + 0.522266 × ln TVL) × growth × maturity × exp(category adjustment)`,
  an OLS fit of log market cap on log TVL over the 128 traded-token protocols that carry a market cap,
  with a shrunk per-category residual adjustment (capped ±0.70).
- **Launch odds:** P(a protocol ever records a token), from the peers' record — category token rate
  shrunk toward the global 0.2171, times the age-band rate over the global rate, capped to [0.02, 0.60].
- **Implied value = launch value × launch odds.** The board ranks by it.
- **Farm verdict:** farmers share an assumed 5% of the expected value over an estimated farmer base;
  net per farmer after the costed plan decides FARM (net > $50), THIN (net > $0) or SKIP.
- **Validation, measured on every run:** two random 80/20 held-out splits and two walk-forward splits,
  refitting on the train set only. Mean median |log error|: fitted 1.16 vs the starter's flat
  0.25×TVL 1.51 (about 23% lower) — the program prints the full table on each run.

## Coverage — all 758 protocols accounted for

197 ranked pre-token rows (the 40-protocol watchlist + 157 early rows below the floor), 416 already
trading (top 24 shown live), 145 excluded with reason (wrapped / staked / bridged / versioned products
are not launches waiting to happen — WBTC is Bitcoin on Ethereum).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. The program writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory, deterministically — two runs write the
same bytes.

## License

MIT — see [LICENSE](LICENSE).
