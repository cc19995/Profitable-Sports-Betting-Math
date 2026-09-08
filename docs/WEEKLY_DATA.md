# Weekly edge data

The desk already had opponent-adjusted ratings, rest, and a wind stub. It could **not** see injuries, real forecasts, news, or multi-book tape unless someone typed a QB adjustment in Lab. That is the missing input, not a new profit gate.

Week 1 of 2026 NCAAF was 22–27 profit-gated bets at ~50% with ~61% mean P. That sample is too small to retune the live book. The 2025 NCAAF holdout that locked the book is still **426 bets, +6.2% ROI**. NFL stays sat. This ingest adds principle-driven situational data so Week 2 prices are not blind.

## What gets collected every week

| Feed | Source | Auth | Used for |
| --- | --- | --- | --- |
| Injury reports | ESPN `site.web.api` `/injuries` | none | QB / OL / WR / EDGE / CB drop-off on expected score |
| Kickoff weather | Open-Meteo geocode + hourly forecast | none | Totals (wind, gusts, precip, snow, cold). Domes = 0 |
| Headlines | ESPN `/news?limit=50` | none | Team-matched flags. Only a missing QB headline can move P, at Questionable weight |
| Multi-book lines | Action Network public scoreboard | none | Consensus / best / range vs ESPN open→current. **Not** auto-followed |
| EPA / SRS | nflverse + sportsdataverse + ESPN scoreboard | none | Already in the House / SRS engines |
| Public bet % / money % | Action Network fields | currently `null` without PRO | Stored when present; not required |

`site.api.espn.com` is 403 from this environment (Akamai). Collectors prefer `site.web.api.espn.com` and fall back.

SportsDataIO, paid odds APIs, and VSiN HTML splits are **not** in the loop. Do not add keys just to chase ticket-count theater.

College injury pages are thin (often a handful of teams). The collector still runs; missing CFB injury cards stay at zero rather than inventing names.

## How to run it

```bash
npm run ingest:week    # ESPN slate + injuries + Open-Meteo + news + Action Network
npm run refresh        # full ratings rebuild; also attaches the same edge object to the board
```

Cadence: run `ingest:week` Thursday, Friday, Saturday morning, and 90 minutes before the early window. `refresh` already calls the same attach path, so the live desk picks this up without a second tool.

Cache (gitignored, under `data/cache/`):

- injuries / news: 2 hours
- Action Network: 45 minutes
- Open-Meteo: 6 hours
- geocodes: 30 days

`data/week-edge.json` is the compact ingest dump (also gitignored).

## What actually moves the number

Applied to expected score (SRS **and** House, because live NCAAF is SRS):

1. **QB Out / Doubtful / Suspension** — NFL −3.8 home/away points; NCAAF −5.2. Questionable is 35% of that. IR-only backup is −0.4 and is ignored if another QB is already Out.
2. **Non-QB personnel** — OL / WR / TE / EDGE / CB / S / PK with a starter→replacement prior, OL cluster extra at 2 and 3+, cap 6 points per team. Offense injuries cut that team’s score; defense injuries add to the opponent.
3. **Weather** — existing wind slope, plus precip / snow / cold. Indoor/dome is zero.

Not applied, only shown:

- Consensus vs ESPN, open→current move, book disagreement (“steam hint”)
- Headlines other than a missing-QB flag
- Public percentages (null on the free Action Network payload)

Closing-line value remains a **grading** metric after the game, not a live feature. You cannot compute CLV until the close exists.

## Mapping from the 32-section wishlist

Most of that list is already in the House EPA cards (pass/run EPA, success, CPOE, sacks, tempo) or is a diagnostic (residuals, SOS, luck). This ingest fills the hole the Gaussian cannot see: **who is actually playing, what the air is doing, and where the price has gone**.

Player-prop volume, man/zone splits, and PFF-style win rates are not on a stable public feed. Do not scrape a paywall for them.

## Overfitting

| Item | Sample / window | Principle vs curve-fit | Risk | Hold out |
| --- | --- | --- | --- | --- |
| Keep the profit gate / sit NFL | 2025 NCAAF holdout n=426; Week 1 n=22–27 | Principle (Gaussian overstates P) | low | Weeks 2–4 before any gate change |
| Add injury/weather/news/tape | Literature priors, not fit to Saturday’s 1-5 | Principle | medium on **magnitudes** (3.8 QB, wind slope); low on **including the feeds** | Recalibrate magnitudes only after a season of CLV, not after one weekend |
| Auto-follow steam or public % | Would be a one-week fit to market | Curve-fit | high | Do not ship |

Lowest-overfit next step: keep ingesting, keep the gate, keep NFL sat, grade CLV on Weeks 2–4.
