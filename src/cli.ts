import { handicapMatchup, bestPlusEv } from "@/src/lib/matchup";
import { evaluateParlay } from "@/src/lib/parlay";
import { expectedValueFromOdds } from "@/src/lib/ev";
import { americanToImplied, parseAmericanOdds } from "@/src/lib/odds";
import { isLeague } from "@/src/lib/league";
import { refreshAll } from "@/src/data/pipeline";
import { readSnapshot } from "@/src/data/loadSnapshot";

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
    qbHome: hasFlag("qb-home") ? Number(arg("qb-home")) : 0,
    qbAway: hasFlag("qb-away") ? Number(arg("qb-away")) : 0,
  });
  console.log(JSON.stringify({
    projection: report.projection,
    priced: report.priced,
    bestBet: bestPlusEv(report.priced),
    confidence: report.confidence,
    diagnostics: report.diagnostics,
  }, null, 2));
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
  console.log(`Usage:
  npm run refresh
  npm run model -- board --league nfl
  npm run model -- matchup --league nfl --home SEA --away NE
  npm run model -- price --p 0.58 --odds -110
  npm run model -- parlay --legs "SEA ML:0.62:-185,Over 44.5:0.55:-105"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
