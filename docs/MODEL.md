# Football +EV model

The desk turns the repository math into NFL and NCAA Football prices.

## What it estimates

For each matchup it produces a handicapped probability **P** for moneyline, spread, and total sides, then compares P to the sportsbook implied probability **S**.

```
Δ$ / N = B (P / S − 1) > 0  iff  P > S
```

S includes juice. A side is marked +EV only when that inequality holds.

## How P is built

NFL and NCAAF are **separate House models** in the Rithmm layout: statistics → five factors (Running, Passing, Offense, Defense, Ranks) → weighted projection → DTM (P − S).

1. Ingest public EPA data. NFL: nflverse `stats_team_week` (pass/rush EPA, CPOE, sacks). NCAAF: sportsdataverse weekly team summaries (pass/rush EPA, success, tempo) plus opponent-adjusted ratings. Snapshots are as-of the prior week so week W does not leak week W results.
2. Convert those stats to 0–100 factor cards (league-z-scored). Defense is flipped so higher is better.
3. Apply the league House weights (NFL pass-heavy; NCAAF keeps more run/rank mass). Custom sliders in Lab do not change the live desk.
4. Push the projected score through a Gaussian. NFL cover probabilities still get a small 3/7 key correction.
5. Price each posted side. DTM is the same gap as edge: model P minus sportsbook S.

SRS from final scores remains a fallback when a club has no EPA card (typical FCS / thin sample). Live Best Bets stay NCAAF-only until the NFL House holdout is positive.

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
| Wind / precip / dome | Totals first | medium |
| Injury report (QB, OL cluster, CB) | Expected-score adjustment from ESPN ingest | medium |
| Open vs current / consensus tape | Diagnostic; not auto-followed | medium |
| ESPN headlines | Backup QB flag only | medium |
| Residual / last-4 form | Shown, not auto-faded | high |

## Holdout

Walk-forward: fit on all games before week W of the holdout season, then price that week against closing-style lines. That is the calibration number on `/calibration`. It is a finite sample. Do not treat one season of flags as proof the market is beaten.

- **NFL:** same profit rule vs nflverse closes, for diagnosis only. Two holdout seasons lost money, so the **live desk sits NFL**. The holdout stays on `/calibration` so that sit is auditable.
- **NCAAF:** same rule vs ESPN BET closes, on the **prior completed season** (2025 while 2026 is in progress). Historical ESPN scoreboards do not include lines; closes are attached from the ESPN core odds API. Pushes are dropped. This is the only live betting book.

The profit rule sits on top of the trust filter: no moneylines, raw edge at least 4%, EV capped at 45%, and the projection must be close to the market (alignment ≥ 0.8). That is because this Gaussian overstates P on dogs and on 10-point disagreements. We sit NFL rather than further restrict to NCAAF totals-only after seeing 2025 — that extra cut would be a one-year curve-fit.

## What this is not

It is not a closer, not a same-game correlation model, and not advice. Fractional Kelly still loses if P is miscalibrated. Weekly injury/weather/news/tape ingest is documented in [WEEKLY_DATA.md](WEEKLY_DATA.md).
