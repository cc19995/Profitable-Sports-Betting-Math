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
4. **Process leftovers** — pass-rush vs protection (cap 1.4), explosive environment on the total (cap 1.6), fumble-recovery luck fade (cap 1.1), CFB red-zone finishing vs success (cap 0.6). NFL West-Coast early Eastern kickoff −0.7 to −1.0 away. These rates already leak into EPA; the caps exist so we do not double-count.

Not applied, only shown:

- Consensus vs ESPN, open→current move, book disagreement (“steam hint”)
- Headlines other than a missing-QB flag
- Public percentages (null on the free Action Network payload)

Closing-line value remains a **grading** metric after the game, not a live feature. You cannot compute CLV until the close exists.

## Mapping from the 32-section wishlist

Status key:

- **Applied** — moves expected score / total on SRS and House (live NCAAF is SRS).
- **In P already** — inside House EPA or SRS; not a second copy.
- **Diagnostic** — shown on the matchup sheet / tape. Does not move P.
- **Not collectable** — no stable public weekly feed. Will not scrape a paywall.

| § | Topic | Status | What we actually have |
| --- | --- | --- | --- |
| 1 | Market / betting metrics | Mixed | ESPN open→current spread/total/ML implied-P move. Action Network multi-book consensus, best line, range, steam *hint*. Public ticket/money stored when non-null (usually null on the free payload). **Not** auto-followed. CLV is post-close grading only. |
| 2 | Overall team strength | In P already | SRS off/def/net, SOS, House off/def/ranks, adj EPA (CFB), pass/rush EPA. |
| 3 | Offensive efficiency | In P already + applied leftover | Pass/rush EPA, CPOE, sack rate. CFB success / explosive / pass rate now on the process card. NFL first-down rate and 20+ rate as success/explosive proxies. |
| 4 | Quarterback metrics | Partial | CPOE + pass EPA in House. Injury-report QB Out/Q/IR. No public weekly EPA-under-pressure, BTT, or man/zone accuracy. |
| 5 | Offensive line | Partial applied | Sack rate allowed + CFB havoc/stuffed → protection score. ESPN OL cluster injuries. No PFF pass-block win rate. |
| 6 | Defensive efficiency | In P already | Pass/rush EPA allowed, sacks, CFB success/explosive/havoc allowed. |
| 7 | Pass rush vs OL | **Applied (capped)** | Process pressure differential, cap 1.4 pts. Four-man havoc/sacks vs protection. |
| 8 | WR vs secondary | Not collectable | No weekly separation / man-zone / yards-per-route feed. CB injuries are applied. |
| 9 | Situational downs | Diagnostic / CFB process | CFB early-down EPA is already in adj EPA. Third-down success is on the CFB process card for RZ-style regression only; not a third-down betting trigger. |
| 10 | Red zone | **Applied (capped) when it diverges** | CFB red-zone success vs down-to-down success, cap 0.6. NFL has no RZ trip feed — left at 50. |
| 11 | Explosiveness | **Applied to total (capped)** | NFL 20+ pass/rush; CFB explosive_off/def. Cap 1.6 on the total. |
| 12 | Turnovers | **Applied fumble luck only (capped)** | NFL fumbles lost vs opp recoveries. Cap 1.1. INT rate stays inside EPA. Do not bet raw TO margin. |
| 13 | Special teams | Diagnostic / injuries | FG% and ST TDs are in the nflverse file but not in P (noisy). PK injuries applied. |
| 14 | Pace / tempo | In P already | House tempo from plays/game. |
| 15 | Game script | Not collectable | No weekly leading/trailing pass-rate split in the public dumps we use. |
| 16 | Coaching | Not collectable | ATS coach trends are noise. No fourth-down GOAT feed on a public weekly cadence. |
| 17 | Injuries | **Applied** | ESPN injury report: QB, OL cluster, WR/TE/EDGE/CB/S/PK, starter→replacement priors. |
| 18 | Rest / scheduling | **Applied** | Rest differential already. West-Coast *early Eastern* (12–2 PM ET) body-clock prior, NFL only, −0.7 to −1.0 away. Not Thursday/Sunday night. |
| 19 | Weather | **Applied** | Open-Meteo wind/gust/precip/snow/cold. Domes zeroed. |
| 20 | Stadium / HFA | In P already | League HFA prior; neutral sites zeroed. No crowd-noise model. |
| 21 | Strength of schedule | In P already + diagnostic | SRS SOS; CFB adj EPA vs strength faced. |
| 22 | Recent performance | In P already + diagnostic | Recency decay in SRS; last-4 residual shown, not auto-chased. |
| 23 | Regression | Partial applied | Fumble luck + RZ-vs-success. One-score record and Pythagorean are **diagnostic only**. |
| 24 | Pythagorean / expected record | Diagnostic | Actual wins vs Pythagorean (exp 2.37). Not subtracted from P — residual margin already captures score luck. |
| 25 | Luck metrics | Diagnostic + fumble fade | Residuals, one-score clustering, fumble recovery. Defensive TDs / dropped INTs not separately collected. |
| 26 | Scheme matchups | Not collectable | No public weekly man/zone, box, or RPO rates. |
| 27 | CFB-specific | Partial | adj EPA, success, havoc, explosive, line yards / stuffed, tempo. No SP+/FEI/FPI (proprietary). No recruiting/portal scrape. |
| 28 | Player props | Out of scope | Desk prices ML/spread/total, not props. |
| 29 | Totals stack | Applied pieces | Pace + EPA + explosive + weather + injuries + market total move (shown). PROE only as CFB pass rate on the card, not a separate total model. |
| 30 | Spread stack | Applied pieces | Net rating, pass matchup, pressure, injuries, SOS, rest, weather, market price. |
| 31 | Moneyline | Priced, not live | P vs S is computed. Live book sits ML (Gaussian overstates P). |
| 32 | Model feature groups | This | Core rating + QB injury + matchup process + situational (rest/travel/weather/injuries) + regression (fumble/RZ) + market tape. |

### Top 15 — honest coverage

| # | Metric | In the live number? |
| --- | --- | --- |
| 1 | Net EPA/play | Yes (House / SRS) |
| 2 | EPA/dropback | Yes (pass EPA) |
| 3 | QB EPA/dropback | Partially (pass EPA + CPOE; not a separate QB card) |
| 4 | Success rate | Yes on the process card (CFB true success; NFL first-down proxy) |
| 5 | Explosive play differential | Yes, capped on the total |
| 6 | Pass rush vs pass protection | Yes, capped |
| 7 | QB pressure performance | No public weekly feed |
| 8 | Injuries / replacement | Yes |
| 9 | Strength-adjusted ratings | Yes |
| 10 | Turnover regression | Fumble luck only, capped |
| 11 | Red-zone regression | CFB only, when finishing diverges from success |
| 12 | Rest/travel | Yes, plus WC early window |
| 13 | Weather | Yes |
| 14 | Open vs current line | Diagnostic |
| 15 | P vs sportsbook implied S | Yes — the actual bet condition |

**Closing Line Value** remains the post-game skill metric. It is not an input to P.

Player-prop volume, PFF win rates, man/zone, SP+/FEI, and practice participation are still not on a stable public feed. Do not scrape a paywall for them.

## Overfitting

| Item | Sample / window | Principle vs curve-fit | Risk | Hold out |
| --- | --- | --- | --- | --- |
| Keep the profit gate / sit NFL | 2025 NCAAF holdout n=426; Week 1 n=22–27 | Principle (Gaussian overstates P) | low | Weeks 2–4 before any gate change |
| Add injury/weather/news/tape | Literature priors, not fit to Saturday’s 1-5 | Principle | medium on **magnitudes** (3.8 QB, wind slope); low on **including the feeds** | Recalibrate magnitudes only after a season of CLV, not after one weekend |
| Auto-follow steam or public % | Would be a one-week fit to market | Curve-fit | high | Do not ship |
| Process leftovers (pressure, explosives, fumble luck, WC early) | Literature priors, tight caps, not fit to Week 1 | Principle | medium on **magnitudes**; low on **including** the rates | Recalibrate caps only after a season of CLV |
| Fade Pythagorean / one-score into P | Would double-count residual margin | Curve-fit | high | Keep diagnostic |

Lowest-overfit next step: keep ingesting, keep the gate, keep NFL sat, grade CLV on Weeks 2–4.
