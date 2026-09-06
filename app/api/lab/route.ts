import { NextResponse } from "next/server";
import { isLeague } from "@/src/lib/league";
import { handicapMatchup } from "@/src/lib/matchup";
import { evaluateParlay } from "@/src/lib/parlay";
import { expectedValueFromOdds } from "@/src/lib/ev";
import { parseAmericanOdds } from "@/src/lib/odds";
import { readSnapshot } from "@/src/data/loadSnapshot";
import type { HouseWeights } from "@/src/lib/rithmm/types";
import type { MarketLines } from "@/src/lib/types";

export const dynamic = "force-dynamic";

interface LabBody {
  mode?: "matchup" | "price" | "parlay";
  league?: string;
  homeId?: string;
  awayId?: string;
  qbHome?: number;
  qbAway?: number;
  userHome?: number;
  userAway?: number;
  market?: MarketLines;
  houseWeights?: HouseWeights;
  p?: number;
  odds?: number | string;
  legs?: Array<{ label: string; p: number; americanOdds: number }>;
}

export async function POST(request: Request) {
  let body: LabBody;
  try {
    body = (await request.json()) as LabBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    if (body.mode === "price") {
      if (body.p === undefined || body.odds === undefined) {
        return NextResponse.json({ error: "p and odds are required" }, { status: 400 });
      }
      const americanOdds = parseAmericanOdds(body.odds);
      const ev = expectedValueFromOdds(body.p, americanOdds, 1);
      return NextResponse.json({ p: body.p, americanOdds, ev, plusEv: ev > 0 });
    }
    if (body.mode === "parlay") {
      if (!body.legs) {
        return NextResponse.json({ error: "legs are required" }, { status: 400 });
      }
      return NextResponse.json(evaluateParlay(body.legs));
    }

    const league = body.league ?? "nfl";
    if (!isLeague(league)) {
      return NextResponse.json({ error: "league must be nfl or ncaaf" }, { status: 400 });
    }
    if (!body.homeId || !body.awayId) {
      return NextResponse.json({ error: "homeId and awayId are required" }, { status: 400 });
    }
    const snapshot = await readSnapshot();
    if (!snapshot) {
      return NextResponse.json({ error: "No snapshot yet. Run npm run refresh." }, { status: 404 });
    }
    const pack = league === "nfl" ? snapshot.nfl : snapshot.ncaaf;
    const home = pack.ratings.find((row) => row.team.id === body.homeId || row.team.abbreviation === body.homeId);
    const away = pack.ratings.find((row) => row.team.id === body.awayId || row.team.abbreviation === body.awayId);
    if (!home || !away) {
      return NextResponse.json({ error: "unknown team id" }, { status: 404 });
    }
    const factorBook = pack.factorBook ?? [];
    const report = handicapMatchup({
      game: {
        id: `lab:${away.team.id}@${home.team.id}`,
        league,
        season: new Date().getUTCFullYear(),
        week: 99,
        gameType: "LAB",
        kickoffIso: new Date().toISOString(),
        home: home.team,
        away: away.team,
        neutralSite: false,
        market: body.market,
      },
      ratings: pack.ratings,
      qbHome: body.qbHome,
      qbAway: body.qbAway,
      userHome: body.userHome,
      userAway: body.userAway,
      houseWeights: body.houseWeights,
      factorLookup: (teamId) =>
        factorBook.find((row) => row.teamId === teamId || row.abbreviation === teamId),
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "lab failed" },
      { status: 400 },
    );
  }
}
