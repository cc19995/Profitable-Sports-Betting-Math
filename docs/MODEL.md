# Football +EV model

The desk turns the repository math into NFL and NCAA Football prices.

## What it estimates

For each matchup it produces a handicapped probability **P** for moneyline, spread, and total sides, then compares P to the sportsbook implied probability **S**.

```
Δ$ / N = B (P / S − 1) > 0  iff  P > S
```

S includes juice. A side is marked +EV only when that inequality holds.

## How P is built

1. Fit opponent-adjusted offensive and defensive ratings (iterative SRS with recency decay and shrinkage) on completed games.
2. Convert ratings plus home-field, rest, and wind into an expected score.
3. Push that score through a Gaussian margin/total distribution. NFL cover probabilities get a small discrete correction around the 3 and 7 keys.
4. Price each posted side: P, S, de-vigged S′, juice, edge, EV/unit, quarter-Kelly.

NFL ratings use nflverse completed regular season and playoffs (prior two seasons plus the current year). Live NFL and all NCAA lines/scores come from ESPN public scoreboards.

## Which book is S?

The desk prices **one** posted number per game, not a shop:

- Live NFL and all NCAAF: ESPN scoreboard `odds[0]`. On the current snapshot that provider is **DraftKings**.
- NFL games that only have a schedule line: **nflverse closing line** (`nflverse-close`), a consensus-style close, not Hard Rock.
- Hard Rock is not ingested.

P vs S is only valid at the book that posted that S. If you bet Hard Rock, re-price the same side in Lab at Hard Rock juice. Scanning extra books is useful to see whether the market agrees with itself; it is not an edge if you cannot bet that number.

## Statistics the desk surfaces

Principle-driven, not fit to last week's losers:

| Stat | Role | Overfit risk |
| --- | --- | --- |
| Opponent-adjusted off/def | Builds expected score | low |
| P vs S after juice | Only profitability condition | low |
| Key numbers 3 and 7 | Cover equity is lumpy | low |
| SOS | Records are not probabilities | low |
| Rest / bye | Modest point adjustment | medium |
| Wind / dome | Totals first | medium |
| QB availability | User-entered; model cannot see a late scratch | medium |
| Residual / last-4 form | Shown, not auto-faded | high |

## Holdout

Walk-forward: fit on all games before week W of the holdout season, then take only +EV sides against that week's closing-style lines. That is the calibration number on `/calibration`. It is a finite sample. Do not treat one season of NFL (~200-400 +EV flags) as proof the market is beaten.

## What this is not

It is not a closer, not an injury feed, not a same-game correlation model, and not advice. Fractional Kelly still loses if P is miscalibrated.
