import { buildAdjustments } from "./adjustments";
import { expectedValuePerBet, isPlusEv } from "./ev";
import { coverProbabilities, keyNumberNote, totalProbabilities, winProbabilities } from "./keyNumbers";
import { fractionalKelly } from "./kelly";
import { getLeagueConstants } from "./league";
import { americanToImplied, assertFiniteNumber, devigTwoWay } from "./odds";
import { expectedScores, ratingById } from "./ratings";
import { buildDiagnostics, confidenceReport } from "./features";
import type {
  CompletedGame,
  MarketLines,
  MatchupReport,
  PricedSide,
  TeamRating,
  UpcomingGame,
} from "./types";

function parseOdds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return assertFiniteNumber(value, "odds");
}

function priceSide(args: {
  betType: PricedSide["betType"];
  side: PricedSide["side"];
  label: string;
  p: number;
  americanOdds: number;
  oppositeOdds?: number;
}): PricedSide {
  const impliedS = americanToImplied(args.americanOdds);
  const fairS = args.oppositeOdds !== undefined
    ? (args.side === "away" || args.side === "under"
      ? devigTwoWay(args.oppositeOdds, args.americanOdds).awayFair
      : devigTwoWay(args.americanOdds, args.oppositeOdds).homeFair)
    : impliedS;
  return {
    betType: args.betType,
    side: args.side,
    label: args.label,
    americanOdds: args.americanOdds,
    handicappedP: args.p,
    impliedS,
    fairS,
    juice: impliedS - fairS,
    edge: args.p - impliedS,
    evPerUnit: expectedValuePerBet(args.p, impliedS, 1),
    kellyFull: fractionalKelly(args.p, impliedS, 1),
    kellyQuarter: Math.max(0, fractionalKelly(args.p, impliedS, 0.25)),
    plusEv: isPlusEv(args.p, impliedS),
  };
}

export function handicapMatchup(args: {
  game: UpcomingGame | CompletedGame;
  ratings: TeamRating[];
  qbHome?: number;
  qbAway?: number;
  userHome?: number;
  userAway?: number;
  marketOverride?: MarketLines;
}): MatchupReport {
  const home = ratingById(args.ratings, args.game.home.id);
  const away = ratingById(args.ratings, args.game.away.id);
  const constants = getLeagueConstants(args.game.league);
  const market = args.marketOverride ?? args.game.market;
  const adjustments = buildAdjustments({
    league: args.game.league,
    neutralSite: args.game.neutralSite,
    homeRestDays: args.game.homeRestDays,
    awayRestDays: args.game.awayRestDays,
    windMph: args.game.windMph,
    indoor: "indoor" in args.game ? args.game.indoor : undefined,
    roof: args.game.roof,
    qbHome: args.qbHome,
    qbAway: args.qbAway,
    userHome: args.userHome,
    userAway: args.userAway,
  });

  const scores = expectedScores({
    home,
    away,
    league: args.game.league,
    neutralSite: args.game.neutralSite,
    restAdjustment: adjustments.rest,
    weatherTotalAdjustment: adjustments.weatherTotal,
    qbHome: adjustments.qbHome,
    qbAway: adjustments.qbAway,
    userHome: adjustments.userHome,
    userAway: adjustments.userAway,
  });

  const margin = scores.homeScore - scores.awayScore;
  const total = scores.homeScore + scores.awayScore;
  const wins = winProbabilities({ expectedMargin: margin, sigma: constants.marginSigma });
  const spreadLine = market?.homeSpread ?? -margin;
  const covers = coverProbabilities({
    expectedMargin: margin,
    homeSpread: spreadLine,
    sigma: constants.marginSigma,
    league: args.game.league,
  });
  const totalLine = market?.total ?? total;
  const totals = totalProbabilities({
    expectedTotal: total,
    totalLine,
    sigma: constants.totalSigma,
  });

  const projection = {
    homeScore: scores.homeScore,
    awayScore: scores.awayScore,
    margin,
    total,
    winProbHome: wins.home,
    winProbAway: wins.away,
    coverProbHome: covers.home,
    coverProbAway: covers.away,
    pushProbSpread: covers.push,
    overProb: totals.over,
    underProb: totals.under,
    pushProbTotal: totals.push,
  };

  const priced: PricedSide[] = [];
  const homeMl = parseOdds(market?.homeMoneyline);
  const awayMl = parseOdds(market?.awayMoneyline);
  if (homeMl !== undefined) {
    priced.push(priceSide({
      betType: "moneyline",
      side: "home",
      label: `${args.game.home.abbreviation} ML`,
      p: projection.winProbHome,
      americanOdds: homeMl,
      oppositeOdds: awayMl,
    }));
  }
  if (awayMl !== undefined) {
    priced.push(priceSide({
      betType: "moneyline",
      side: "away",
      label: `${args.game.away.abbreviation} ML`,
      p: projection.winProbAway,
      americanOdds: awayMl,
      oppositeOdds: homeMl,
    }));
  }
  const homeSpreadOdds = parseOdds(market?.homeSpreadOdds);
  const awaySpreadOdds = parseOdds(market?.awaySpreadOdds);
  if (market?.homeSpread !== undefined && homeSpreadOdds !== undefined) {
    priced.push(priceSide({
      betType: "spread",
      side: "home",
      label: `${args.game.home.abbreviation} ${market.homeSpread > 0 ? "+" : ""}${market.homeSpread}`,
      p: projection.coverProbHome,
      americanOdds: homeSpreadOdds,
      oppositeOdds: awaySpreadOdds,
    }));
  }
  if (market?.homeSpread !== undefined && awaySpreadOdds !== undefined) {
    const awaySpread = -market.homeSpread;
    priced.push(priceSide({
      betType: "spread",
      side: "away",
      label: `${args.game.away.abbreviation} ${awaySpread > 0 ? "+" : ""}${awaySpread}`,
      p: projection.coverProbAway,
      americanOdds: awaySpreadOdds,
      oppositeOdds: homeSpreadOdds,
    }));
  }
  const overOdds = parseOdds(market?.overOdds);
  const underOdds = parseOdds(market?.underOdds);
  if (market?.total !== undefined && overOdds !== undefined) {
    priced.push(priceSide({
      betType: "total",
      side: "over",
      label: `Over ${market.total}`,
      p: projection.overProb,
      americanOdds: overOdds,
      oppositeOdds: underOdds,
    }));
  }
  if (market?.total !== undefined && underOdds !== undefined) {
    priced.push(priceSide({
      betType: "total",
      side: "under",
      label: `Under ${market.total}`,
      p: projection.underProb,
      americanOdds: underOdds,
      oppositeOdds: overOdds,
    }));
  }

  const diagnostics = buildDiagnostics({
    game: args.game,
    home,
    away,
    projection,
    adjustments,
    market,
  });
  const keyNote = keyNumberNote(market?.homeSpread);
  if (keyNote) {
    diagnostics.unshift({
      key: "keyNumber",
      label: "Key number",
      homeValue: market?.homeSpread !== undefined ? String(market.homeSpread) : "—",
      awayValue: market?.homeSpread !== undefined ? String(-market.homeSpread) : "—",
      note: keyNote,
      bettingRelevance: "Half-point values around 3 and 7 change cover equity more than a typical 0.5.",
    });
  }

  return {
    game: args.game,
    projection,
    ratings: { home, away },
    adjustments,
    market,
    priced,
    diagnostics,
    confidence: confidenceReport({ home, away, game: args.game }),
  };
}

export function isActionable(
  side: PricedSide,
  market?: { homeSpread?: number; total?: number },
  modelMargin?: number,
  modelTotal?: number,
  league?: "nfl" | "ncaaf",
): boolean {
  if (!side.plusEv || side.edge < 0.02) {
    return false;
  }
  const spreadGap =
    market?.homeSpread !== undefined && modelMargin !== undefined ? modelMargin + market.homeSpread : 0;
  const totalGap =
    market?.total !== undefined && modelTotal !== undefined ? modelTotal - market.total : 0;
  const spreadSize = Math.max(Math.abs(market?.homeSpread ?? 0), Math.abs(modelMargin ?? 0));
  if (league === "ncaaf" && (side.betType === "spread" || side.betType === "moneyline") && Math.abs(market?.homeSpread ?? 0) >= 17) {
    return false;
  }

  if (side.betType === "spread") {
    return side.side === "home" ? spreadGap >= 2.5 : spreadGap <= -2.5;
  }
  if (side.betType === "moneyline") {
    if (spreadSize >= 14) {
      return false;
    }
    return side.side === "home" ? spreadGap >= 2.5 : spreadGap <= -2.5;
  }
  if (side.betType === "total") {
    return side.side === "over" ? totalGap >= 3.5 : totalGap <= -3.5;
  }
  return false;
}

export function bestPlusEv(
  priced: PricedSide[],
  market?: { homeSpread?: number; total?: number },
  modelMargin?: number,
  modelTotal?: number,
  league?: "nfl" | "ncaaf",
): PricedSide | null {
  const plus = priced.filter((side) => isActionable(side, market, modelMargin, modelTotal, league));
  if (plus.length === 0) {
    return null;
  }
  return plus.reduce((best, side) => (side.evPerUnit > best.evPerUnit ? side : best));
}
