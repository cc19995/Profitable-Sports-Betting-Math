# Football +EV Desk

A handicapping desk for **NFL** and **NCAA Football** that implements the +EV math in this repository.

The original write-up is unchanged at [docs/PLUS_EV_MATH.md](docs/PLUS_EV_MATH.md). The model notes are at [docs/MODEL.md](docs/MODEL.md).

Handicapping here does not pick winners. It assigns a probability **P** and compares it to the sportsbook implied probability **S**. Average gain per unit stake is `B(P/S − 1)`. That is positive if and only if **P > S** after juice.

## What you get

- Separate NFL and NCAAF House models in the Rithmm layout: EPA statistics → Running / Passing / Offense / Defense / Ranks → DTM (P − S)
- Projected score, win %, cover %, over/under %
- Market S, de-vigged S′, juice, edge, EV/unit, quarter-Kelly (live S is ESPN/DraftKings; some NFL rows are nflverse close)
- Matchup sheet of the stats that actually change a football price
- Best Bet tab: NCAAF-only profit-filter singles (NFL is sat; raw EV monsters are filtered out)
- Parlay Combos tab: auto-built 2- and 3-leg tickets from that pool, never two legs from the same game
- Manual +EV parlay builder that compounds only when every leg is +EV
- Walk-forward holdout vs closing-style lines

## Run it

```bash
npm install
npm test
npm run refresh    # nflverse + ESPN → data/snapshot.json
npm run dev        # http://localhost:3000
```

CLI:

```bash
npm run model -- board --league nfl
npm run model -- best --league nfl
npm run model -- combos --league nfl
npm run model -- matchup --league nfl --home SEA --away NE
npm run model -- price --p 0.58 --odds -110
npm run model -- parlay --legs "SEA ML:0.62:-185,Over 44.5:0.55:-105"
```

## Using the desk

1. Open **Best Bet** for ranked singles, or **Board** for the full slate.
2. Open a matchup. Read P vs S, then the diagnostic table — especially SOS, residuals, rest, weather, and key numbers.
3. Price the line **your book** actually offers in **Lab**. Consensus and your juice are not the same number.
4. Open **Parlay Combos** for model-built 2- and 3-leg tickets, or **Builder** to force a ticket. Every leg must be +EV. Otherwise juice compounds against you.
5. Stake with quarter-Kelly, not the full fraction. Variance is not optional; see the original backtest figure.

## Overfitting

NFL HFA and score sigma were measured on 2015–2023 home games (mean home margin 1.87, raw margin SD 14.1). Model sigma is looser than closing-line residual (~12.7) on purpose. Recency, rest, and wind are small principled adjustments. Last-4 form and residual “luck” are displayed, not auto-faded. One season of walk-forward flags is not a license to increase stake size.

## Disclaimer

This is not financial or betting advice. It does not entice anyone to gamble. If you have a gambling problem, call 1-800-GAMBLER.
