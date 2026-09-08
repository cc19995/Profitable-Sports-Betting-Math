import { getLeagueConstants } from "./league";
import type {
  CompletedGame,
  ConfidenceReport,
  GameEdgeContext,
  MarketConsensus,
  MarketLines,
  MatchupAdjustments,
  MatchupDiagnostic,
  ScoreProjection,
  TeamInjuryImpact,
  TeamRating,
  UpcomingGame,
} from "./types";

function fmt(value: number, digits = 1): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function gameEdge(game: UpcomingGame | CompletedGame): GameEdgeContext | undefined {
  return "edge" in game ? game.edge : undefined;
}

function injuryLabel(impact: TeamInjuryImpact | undefined): string {
  if (!impact) {
    return "n/a";
  }
  const notable = impact.listings.filter((row) => row.side !== "ignored" && row.impactPoints >= 0.4);
  if (notable.length === 0 && impact.qbPoints === 0) {
    return "clear";
  }
  if (impact.qbPoints <= -1) {
    const qb = notable.find((row) => row.position === "QB");
    return `QB ${qb?.status ?? "out"}`;
  }
  return notable.slice(0, 2).map((row) => `${row.position} ${row.status}`).join(", ") || "listed";
}

function edgeWeatherLabel(game: UpcomingGame | CompletedGame): string {
  const edge = gameEdge(game);
  if (edge?.weather.description) {
    return edge.weather.description;
  }
  if (game.windMph !== undefined) {
    return `${game.windMph} mph wind`;
  }
  return game.roof ?? "n/a";
}

function marketMoveNote(market: MarketLines | undefined, consensus: MarketConsensus | undefined): string {
  const bits: string[] = [];
  if (market?.openHomeSpread !== undefined && market.homeSpread !== undefined) {
    bits.push(`ESPN spread ${fmt(market.openHomeSpread)} → ${fmt(market.homeSpread)}.`);
  }
  if (market?.openTotal !== undefined && market.total !== undefined) {
    bits.push(`Total ${market.openTotal} → ${market.total}.`);
  }
  if (consensus?.consensusHomeSpread !== undefined) {
    bits.push(`Multi-book median ${fmt(consensus.consensusHomeSpread)}.`);
  }
  if (consensus?.steamHint) {
    bits.push("Books disagree by 1.5+ points.");
  }
  if (bits.length === 0) {
    return "No open/consensus tape on this game.";
  }
  return bits.join(" ");
}

export function buildDiagnostics(args: {
  game: UpcomingGame | CompletedGame;
  home: TeamRating;
  away: TeamRating;
  projection: ScoreProjection;
  adjustments: MatchupAdjustments;
  market?: MarketLines;
}): MatchupDiagnostic[] {
  const constants = getLeagueConstants(args.game.league);
  const edge = gameEdge(args.game);
  const marketSpread = args.market?.homeSpread;
  const spreadGap = marketSpread !== undefined ? args.projection.margin + marketSpread : undefined;
  const totalGap = args.market?.total !== undefined ? args.projection.total - args.market.total : undefined;

  return [
    {
      key: "net",
      label: "Net rating (off+def)",
      homeValue: fmt(args.home.net),
      awayValue: fmt(args.away.net),
      note: "SRS-style points better than an average team after opponent adjustment.",
      bettingRelevance: "Primary driver of spread and moneyline. This is the model's power rating.",
    },
    {
      key: "units",
      label: "Offense / defense",
      homeValue: `${fmt(args.home.offense)} / ${fmt(args.home.defense)}`,
      awayValue: `${fmt(args.away.offense)} / ${fmt(args.away.defense)}`,
      note: "Offense is points added vs average; defense is points suppressed vs average.",
      bettingRelevance: "A great offense vs a weak pass/run defense moves totals and sides more than net rating alone.",
    },
    {
      key: "spreadGap",
      label: "Model vs market spread",
      homeValue: fmt(args.projection.margin),
      awayValue: marketSpread !== undefined ? fmt(marketSpread) : "no line",
      note: spreadGap !== undefined
        ? `Model is ${fmt(spreadGap)} pts away from the market home line.`
        : "No market spread loaded.",
      bettingRelevance: "Sides become interesting only when this gap is large relative to sigma, not when you 'like' a team.",
    },
    {
      key: "totalGap",
      label: "Model vs market total",
      homeValue: args.projection.total.toFixed(1),
      awayValue: args.market?.total !== undefined ? args.market.total.toFixed(1) : "no total",
      note: totalGap !== undefined ? `Model total is ${fmt(totalGap)} vs the posted number.` : "No market total loaded.",
      bettingRelevance: "Totals are where weather, pace, and defensive matchups show up. Do not bet a total because a team 'scores a lot' in a vacuum.",
    },
    {
      key: "sos",
      label: "Strength of schedule",
      homeValue: fmt(args.home.sos),
      awayValue: fmt(args.away.sos),
      note: "Average opponent net rating already faced.",
      bettingRelevance: "Raw records lie. A 3-0 team with a soft SOS is often overbid on the moneyline.",
    },
    {
      key: "luck",
      label: "Residual margin (luck/form)",
      homeValue: fmt(args.home.residualMargin),
      awayValue: fmt(args.away.residualMargin),
      note: "Actual margin minus model-expected margin across the fit window. Positive = outrunning the model.",
      bettingRelevance: "Surface this; do not automatically fade it. Persistent residuals can be missing QB/scheme info. Large L4 residuals are usually noise.",
    },
    {
      key: "form",
      label: "Last-4 residual",
      homeValue: fmt(args.home.last4Residual),
      awayValue: fmt(args.away.last4Residual),
      note: "Short-window outperformance. Small sample by construction.",
      bettingRelevance: "Hot streaks are the most overfit input in football betting. Use as a question, not a trigger.",
    },
    {
      key: "ha",
      label: "Home / away residual",
      homeValue: fmt(args.home.homeResidual),
      awayValue: fmt(args.away.awayResidual),
      note: "Split residuals after the generic home-field term is already applied.",
      bettingRelevance: "Useful when a team is a true home/road outlier. Dangerous with <6 split games.",
    },
    {
      key: "rest",
      label: "Rest adjustment",
      homeValue: args.game.homeRestDays !== undefined ? `${args.game.homeRestDays}d` : "n/a",
      awayValue: args.game.awayRestDays !== undefined ? `${args.game.awayRestDays}d` : "n/a",
      note: `Applied rest points: ${fmt(args.adjustments.rest)}. Bye-week / short-week effects only.`,
      bettingRelevance: "Rest matters most on short weeks and after byes. Do not double-count if the market already moved.",
    },
    {
      key: "weather",
      label: "Weather / roof",
      homeValue: edgeWeatherLabel(args.game),
      awayValue: args.adjustments.weatherTotal.toFixed(1),
      note: edge?.weather.description
        ? `Forecast: ${edge.weather.description}. Applied total trim: ${fmt(args.adjustments.weatherTotal)}.`
        : `Applied weather points: ${fmt(args.adjustments.weatherTotal)}. Wind above ~12 mph trims the total. Domes are zeroed.`,
      bettingRelevance: "Totals first. Sides only if one offense is much more pass-dependent and you have that information.",
    },
    {
      key: "injuries",
      label: "Injuries / replacement",
      homeValue: injuryLabel(edge?.injuries.home),
      awayValue: injuryLabel(edge?.injuries.away),
      note: edge
        ? `QB pts ${fmt(edge.scoreAdjustments.qbHome)} / ${fmt(edge.scoreAdjustments.qbAway)}. Other personnel ${fmt(edge.scoreAdjustments.injuryHome)} / ${fmt(edge.scoreAdjustments.injuryAway)}.`
        : "No weekly injury ingest on this game. Lab can still enter a QB adjustment.",
      bettingRelevance: "Measure starter → replacement drop-off, especially QB and clustered OL/CB. Do not count names.",
    },
    {
      key: "marketMove",
      label: "Open vs current / consensus",
      homeValue: edge?.market.espnSpreadMove !== undefined ? fmt(edge.market.espnSpreadMove) : "n/a",
      awayValue: edge?.market.consensusHomeSpread !== undefined ? fmt(edge.market.consensusHomeSpread) : "n/a",
      note: marketMoveNote(args.market, edge?.market),
      bettingRelevance: "Line movement is information, not a bet. Do not automatically fade or follow steam. Price the number you can actually bet.",
    },
    {
      key: "news",
      label: "Matched headlines",
      homeValue: String(edge?.news.filter((item) => item.teamAbbrs.includes(args.game.home.abbreviation)).length ?? 0),
      awayValue: String(edge?.news.filter((item) => item.teamAbbrs.includes(args.game.away.abbreviation)).length ?? 0),
      note: edge?.news[0]?.headline ?? "No team-matched ESPN headlines on this ingest.",
      bettingRelevance: "Headlines are a backup sensor. Only a missing QB flag can move the number, and then only at Questionable weight.",
    },
    {
      key: "hfa",
      label: "Home field",
      homeValue: fmt(args.adjustments.homeField),
      awayValue: args.game.neutralSite ? "neutral" : "road",
      note: `League HFA prior is ${constants.homeFieldAdvantage.toFixed(1)} pts. Neutral sites zero this.`,
      bettingRelevance: "Bowls, playoffs at neutral sites, and London/Mexico games are common market mistakes if HFA is left on.",
    },
    {
      key: "sample",
      label: "Games in rating",
      homeValue: String(args.home.games),
      awayValue: String(args.away.games),
      note: "Shrinkage pulls small samples toward zero.",
      bettingRelevance: "Week-1 and early CFB ratings are priors. Edges there are the least trustworthy.",
    },
  ];
}

export function confidenceReport(args: {
  home: TeamRating;
  away: TeamRating;
  game: UpcomingGame | CompletedGame;
}): ConfidenceReport {
  const reasons: string[] = [];
  let score = 70;
  const minGames = Math.min(args.home.games, args.away.games);
  const edge = gameEdge(args.game);
  if (minGames < 4) {
    score -= 25;
    reasons.push("Small sample: ratings are mostly last-season priors plus shrinkage.");
  } else if (minGames < 8) {
    score -= 12;
    reasons.push("Mid-small sample. Opponent adjustments are still noisy.");
  }
  if (Math.abs(args.home.last4Residual) > 10 || Math.abs(args.away.last4Residual) > 10) {
    score -= 8;
    reasons.push("A team is running far above/below the model in the last four. That is usually variance, not a new true talent.");
  }
  if (args.game.neutralSite) {
    score -= 4;
    reasons.push("Neutral site: home-field prior is removed, but travel/crowd still exists.");
  }
  if (!args.game.market) {
    score -= 6;
    reasons.push("No market line loaded, so this is a projection rather than a priced bet.");
  }
  if (edge && (edge.scoreAdjustments.qbHome !== 0 || edge.scoreAdjustments.qbAway !== 0)) {
    reasons.push("QB availability from the injury report is applied to expected score. Replacement quality is a prior, not a player model.");
  }
  const outdoor = !("indoor" in args.game && args.game.indoor) && args.game.roof !== "dome" && args.game.roof !== "closed";
  if (outdoor && edge?.weather.source === "none") {
    score -= 3;
    reasons.push("Outdoor game with no forecast attached. Total is missing wind/precip.");
  }
  if (edge?.market.espnSpreadMove !== undefined && Math.abs(edge.market.espnSpreadMove) >= 2) {
    score -= 5;
    reasons.push("Spread has moved 2+ points since open. That is information; it is not a reason to chase the steam.");
  }
  score = Math.max(15, Math.min(92, score));
  if (reasons.length === 0) {
    reasons.push("Both clubs have a usable sample and a market line. Still treat P as a degree of certainty, not a pick.");
  }
  return { score, reasons };
}

export function statsThatMatter(): Array<{ stat: string; why: string; howUsed: string; overfitRisk: string }> {
  return [
    {
      stat: "Opponent-adjusted offensive / defensive rating",
      why: "Football results are opponent-dependent. Unadjusted PPG is not a probability.",
      howUsed: "Builds expected score, then P(win), P(cover), P(over).",
      overfitRisk: "low",
    },
    {
      stat: "Market implied S vs handicapped P",
      why: "The only profitability condition in this repo is P > S after juice.",
      howUsed: "Every priced side. Live Best Bets also require the profit gate and a league whose holdout is not negative.",
      overfitRisk: "low",
    },
    {
      stat: "House factors (pass / run / off / def / ranks)",
      why: "NFL and CFB do not share a talent or pace distribution. Score-only SRS cannot see pass/rush fit.",
      howUsed: "Separate House models. Live desk uses House weights. Lab sliders are custom models only.",
      overfitRisk: "medium",
    },
    {
      stat: "Profit gate + sit NFL",
      why: "The Gaussian overstates P. Raw +EV and even the trust filter still lost money in NFL holdouts.",
      howUsed: "No moneylines, alignment ≥ 0.8, edge ≥ 4%, EV ≤ 45%. Live desk offers NCAAF only.",
      overfitRisk: "medium",
    },
    {
      stat: "Juice / overround",
      why: "You must beat the vig, not a 50/50 coin.",
      howUsed: "De-vig two-way markets; refuse to treat -110 as a fair coin.",
      overfitRisk: "low",
    },
    {
      stat: "Key numbers 3 and 7",
      why: "Scoring is discrete. Cover equity is lumpy around field goals and touchdowns.",
      howUsed: "Half-point awareness on spreads.",
      overfitRisk: "low",
    },
    {
      stat: "Rest / bye / short week",
      why: "Physical game with a documented but modest effect.",
      howUsed: "Point adjustment, not a standalone bet signal.",
      overfitRisk: "medium",
    },
    {
      stat: "Wind / precip / dome",
      why: "Passing efficiency and field-goal range collapse in high wind, snow, and extreme cold.",
      howUsed: "Open-Meteo kickoff-hour forecast. Total adjustment. Indoor/dome zeroed.",
      overfitRisk: "medium",
    },
    {
      stat: "Strength of schedule",
      why: "Records and raw yardage are not calibrated probabilities.",
      howUsed: "Diagnostic on the matchup sheet.",
      overfitRisk: "low",
    },
    {
      stat: "QB availability (injury report)",
      why: "The largest single-player variance in football. A healthy backup is not the starter.",
      howUsed: "ESPN injury feed each refresh. Out/Doubtful QB moves expected score; questionable is 35% of that. Not fit to last week.",
      overfitRisk: "medium",
    },
    {
      stat: "Residual margin / 'luck'",
      why: "Turnovers and close-game clustering regress. They are not a talent measure by themselves.",
      howUsed: "Shown, not auto-faded.",
      overfitRisk: "high",
    },
    {
      stat: "Last-4 form",
      why: "Bettors overweight recency. Four games is not a new rating.",
      howUsed: "Shown as a warning, lightly weighted in the rating decay already.",
      overfitRisk: "high",
    },
  ];
}
