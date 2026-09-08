import { handicapMatchup, bestPlusEv } from "@/src/lib/matchup";
import { evaluateParlay } from "@/src/lib/parlay";
import { collectBestBets, collectParlayCombos } from "@/src/lib/picks";
import { expectedValueFromOdds } from "@/src/lib/ev";
import { americanToImplied, parseAmericanOdds } from "@/src/lib/odds";
import { isLeague } from "@/src/lib/league";
import { refreshAll } from "@/src/data/pipeline";
import { readSnapshot } from "@/src/data/loadSnapshot";
import { attachWeeklyEdge, compactGameEdge } from "@/src/data/weeklyIngest";
import { fetchEspnScoreboard, isCompletedGame } from "@/src/data/espn";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`missing --${name}`);
  }
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function board(): Promise<void> {
  const leagueRaw = arg("league", "nfl");
  if (!isLeague(leagueRaw)) {
    throw new Error("league must be nfl or ncaaf");
  }
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("no snapshot.json — run npm run refresh first");
  }
  const pack = leagueRaw === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  console.log(`${leagueRaw.toUpperCase()} board  generated ${snapshot.generatedAt}`);
  console.log(`ratings ${pack.ratings.length}  completed ${pack.completedCount}  upcoming ${pack.upcomingCount}`);
  for (const row of pack.board.slice(0, 30)) {
    const best = row.bestBet;
    const g = row.game;
    const mark = best ? `+EV ${best.label} EV=${best.evPerUnit.toFixed(3)} P=${best.handicappedP.toFixed(3)} S=${best.impliedS.toFixed(3)}` : "no +EV side";
    console.log(`${g.away.abbreviation} @ ${g.home.abbreviation}  model ${row.report.projection.awayScore.toFixed(1)}-${row.report.projection.homeScore.toFixed(1)}  ${mark}`);
  }
}

async function matchup(): Promise<void> {
  const leagueRaw = arg("league", "nfl");
  if (!isLeague(leagueRaw)) {
    throw new Error("league must be nfl or ncaaf");
  }
  const home = arg("home");
  const away = arg("away");
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("no snapshot.json — run npm run refresh first");
  }
  const pack = leagueRaw === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const game = pack.board.find(
    (row) =>
      row.game.home.abbreviation === home && row.game.away.abbreviation === away,
  )?.game;
  if (!game) {
    throw new Error(`no upcoming ${away} @ ${home} on the ${leagueRaw} board`);
  }
  const report = handicapMatchup({
    game,
    ratings: pack.ratings,
    qbHome: hasFlag("qb-home") ? Number(arg("qb-home")) : undefined,
    qbAway: hasFlag("qb-away") ? Number(arg("qb-away")) : undefined,
  });
  console.log(JSON.stringify({
    projection: report.projection,
    priced: report.priced,
    bestBet: bestPlusEv(
      report.priced,
      game.market,
      report.projection.margin,
      report.projection.total,
      leagueRaw,
      {
        confidence: report.confidence.score,
        homeGames: report.ratings.home.games,
        awayGames: report.ratings.away.games,
      },
    ),
    confidence: report.confidence,
    diagnostics: report.diagnostics,
  }, null, 2));
}

async function best(): Promise<void> {
  const leagueRaw = arg("league", "nfl");
  if (!isLeague(leagueRaw)) {
    throw new Error("league must be nfl or ncaaf");
  }
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("no snapshot.json — run npm run refresh first");
  }
  const pack = leagueRaw === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const picks = collectBestBets(pack.board, 12);
  console.log(`${leagueRaw.toUpperCase()} best bets  generated ${snapshot.generatedAt}`);
  if (picks.length === 0) {
    console.log("no singles cleared the trust filter");
    return;
  }
  for (const [index, pick] of picks.entries()) {
    console.log(
      `${index + 1}. ${pick.matchup}  ${pick.pick.label}  EV=${pick.pick.evPerUnit.toFixed(3)}  P=${pick.pick.handicappedP.toFixed(3)}  S=${pick.pick.impliedS.toFixed(3)}  Q=${pick.quality.toFixed(2)}`,
    );
  }
}

async function combos(): Promise<void> {
  const leagueRaw = arg("league", "nfl");
  if (!isLeague(leagueRaw)) {
    throw new Error("league must be nfl or ncaaf");
  }
  const snapshot = await readSnapshot();
  if (!snapshot) {
    throw new Error("no snapshot.json — run npm run refresh first");
  }
  const pack = leagueRaw === "nfl" ? snapshot.nfl : snapshot.ncaaf;
  const tickets = collectParlayCombos(pack.board, { sameDateOnly: !hasFlag("any-date") });
  console.log(`${leagueRaw.toUpperCase()} parlay combos  generated ${snapshot.generatedAt}`);
  if (tickets.length === 0) {
    console.log("no +EV combos from the best-bet pool");
    return;
  }
  for (const [index, ticket] of tickets.entries()) {
    const legs = ticket.legs.map((leg) => `${leg.matchup} ${leg.pick.label}`).join(" + ");
    console.log(
      `${index + 1}. ${legs}  EV=${ticket.evPerUnit.toFixed(3)}  P=${ticket.modelProb.toFixed(3)}  S=${ticket.impliedProb.toFixed(3)}`,
    );
  }
}

async function ingest(): Promise<void> {
  const [nfl, ncaaf] = await Promise.all([
    fetchEspnScoreboard({ league: "nfl" }).catch((error: unknown) => {
      console.warn("NFL scoreboard unavailable:", error instanceof Error ? error.message : error);
      return [];
    }),
    fetchEspnScoreboard({ league: "ncaaf" }).catch((error: unknown) => {
      console.warn("NCAAF scoreboard unavailable:", error instanceof Error ? error.message : error);
      return [];
    }),
  ]);
  const upcoming = [...nfl, ...ncaaf].filter((game) => !isCompletedGame(game));
  const attached = await attachWeeklyEdge(upcoming);
  const compact = attached.map(compactGameEdge);
  const out = {
    generatedAt: new Date().toISOString(),
    nflGames: compact.filter((row) => row.league === "nfl").length,
    ncaafGames: compact.filter((row) => row.league === "ncaaf").length,
    qbFlags: compact.filter((row) => Math.abs(Number(row.qbHome)) >= 1 || Math.abs(Number(row.qbAway)) >= 1).length,
    outdoorForecasts: compact.filter((row) => row.weather && row.weather !== "indoor" && row.weather !== "no forecast").length,
    games: compact,
  };
  const dest = path.join(process.cwd(), "data", "week-edge.json");
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(out, null, 2));
  console.log(`wrote ${dest}`);
  console.log(`NFL ${out.nflGames}  NCAAF ${out.ncaafGames}  QB flags ${out.qbFlags}  outdoor forecasts ${out.outdoorForecasts}`);
  for (const row of compact.filter((item) => (item.notes as string[]).length > 0).slice(0, 24)) {
    console.log(`${row.matchup}  ${(itemNotes(row)).join(" | ")}`);
  }
}

function itemNotes(row: Record<string, unknown>): string[] {
  const notes = row.notes;
  return Array.isArray(notes) ? notes.map(String) : [];
}

function price(): void {
  const p = Number(arg("p"));
  const odds = parseAmericanOdds(arg("odds"));
  const s = americanToImplied(odds);
  const ev = expectedValueFromOdds(p, odds, 1);
  console.log(JSON.stringify({ p, s, odds, ev, plusEv: ev > 0 }, null, 2));
}

function parlay(): void {
  const raw = arg("legs");
  const legs = raw.split(",").map((chunk, index) => {
    const [label, pRaw, oddsRaw] = chunk.split(":");
    if (!label || !pRaw || !oddsRaw) {
      throw new Error(`leg ${index} must be label:p:odds`);
    }
    return { label, p: Number(pRaw), americanOdds: parseAmericanOdds(oddsRaw) };
  });
  console.log(JSON.stringify(evaluateParlay(legs), null, 2));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "refresh") {
    const snapshot = await refreshAll();
    console.log(`wrote data/snapshot.json at ${snapshot.generatedAt}`);
    console.log(`NFL ratings=${snapshot.nfl.ratings.length} board=${snapshot.nfl.upcomingCount} backtestN=${snapshot.nfl.backtest?.n ?? 0}`);
    console.log(`NCAAF ratings=${snapshot.ncaaf.ratings.length} board=${snapshot.ncaaf.upcomingCount} backtestN=${snapshot.ncaaf.backtest?.n ?? 0}`);
    return;
  }
  if (cmd === "ingest") {
    await ingest();
    return;
  }
  if (cmd === "board") {
    await board();
    return;
  }
  if (cmd === "matchup") {
    await matchup();
    return;
  }
  if (cmd === "price") {
    price();
    return;
  }
  if (cmd === "parlay") {
    parlay();
    return;
  }
  if (cmd === "best") {
    await best();
    return;
  }
  if (cmd === "combos") {
    await combos();
    return;
  }
  console.log(`Usage:
  npm run refresh
  npm run ingest:week
  npm run model -- board --league nfl
  npm run model -- best --league nfl
  npm run model -- combos --league nfl
  npm run model -- matchup --league nfl --home SEA --away NE
  npm run model -- price --p 0.58 --odds -110
  npm run model -- parlay --legs "SEA ML:0.62:-185,Over 44.5:0.55:-105"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
