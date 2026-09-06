import type { HouseWeights, SmartSignal, TeamFactors } from "./rithmm/types";

export type League = "nfl" | "ncaaf";

export type MarketSide = "home" | "away" | "over" | "under";

export type BetType = "moneyline" | "spread" | "total";

export interface LeagueConstants {
  league: League;
  homeFieldAdvantage: number;
  marginSigma: number;
  totalSigma: number;
  averageTeamScore: number;
  priorRetention: number;
  recencyHalfLifeGames: number;
  shrinkageK: number;
}

export interface TeamRef {
  id: string;
  abbreviation: string;
  name: string;
  conference?: string;
}

export interface CompletedGame {
  id: string;
  league: League;
  season: number;
  week: number;
  gameType: string;
  kickoffIso: string;
  home: TeamRef;
  away: TeamRef;
  homeScore: number;
  awayScore: number;
  neutralSite: boolean;
  homeRestDays?: number;
  awayRestDays?: number;
  roof?: string;
  temperatureF?: number;
  windMph?: number;
  market?: MarketLines;
}

export interface UpcomingGame {
  id: string;
  league: League;
  season: number;
  week: number;
  gameType: string;
  kickoffIso: string;
  home: TeamRef;
  away: TeamRef;
  neutralSite: boolean;
  homeRestDays?: number;
  awayRestDays?: number;
  venueName?: string;
  indoor?: boolean;
  roof?: string;
  temperatureF?: number;
  windMph?: number;
  market?: MarketLines;
  homeRecord?: string;
  awayRecord?: string;
}

export interface MarketLines {
  book?: string;
  homeMoneyline?: number;
  awayMoneyline?: number;
  homeSpread?: number;
  homeSpreadOdds?: number;
  awaySpreadOdds?: number;
  total?: number;
  overOdds?: number;
  underOdds?: number;
  openHomeSpread?: number;
  openTotal?: number;
  openHomeMoneyline?: number;
  openAwayMoneyline?: number;
}

export interface TeamRating {
  team: TeamRef;
  offense: number;
  defense: number;
  net: number;
  games: number;
  sos: number;
  avgPointsFor: number;
  avgPointsAgainst: number;
  residualMargin: number;
  last4Residual: number;
  homeResidual: number;
  awayResidual: number;
}

export interface MatchupAdjustments {
  homeField: number;
  rest: number;
  weatherTotal: number;
  qbHome: number;
  qbAway: number;
  userHome: number;
  userAway: number;
}

export interface ScoreProjection {
  homeScore: number;
  awayScore: number;
  margin: number;
  total: number;
  winProbHome: number;
  winProbAway: number;
  coverProbHome: number;
  coverProbAway: number;
  pushProbSpread: number;
  overProb: number;
  underProb: number;
  pushProbTotal: number;
}

export interface PricedSide {
  betType: BetType;
  side: MarketSide;
  label: string;
  americanOdds: number;
  handicappedP: number;
  impliedS: number;
  fairS: number;
  juice: number;
  edge: number;
  evPerUnit: number;
  kellyFull: number;
  kellyQuarter: number;
  plusEv: boolean;
}

export type ProjectionEngine = "house-epa" | "srs-fallback";

export interface MatchupReport {
  game: UpcomingGame | CompletedGame;
  projection: ScoreProjection;
  ratings: {
    home: TeamRating;
    away: TeamRating;
  };
  adjustments: MatchupAdjustments;
  market?: MarketLines;
  priced: PricedSide[];
  diagnostics: MatchupDiagnostic[];
  confidence: ConfidenceReport;
  engine: ProjectionEngine;
  houseWeights?: HouseWeights;
  factors?: { home: TeamFactors; away: TeamFactors };
  signals: SmartSignal[];
}

export interface MatchupDiagnostic {
  key: string;
  label: string;
  homeValue: string;
  awayValue: string;
  note: string;
  bettingRelevance: string;
}

export interface ConfidenceReport {
  score: number;
  reasons: string[];
}

export interface BoardRow {
  game: UpcomingGame;
  report: MatchupReport;
  bestBet: PricedSide | null;
}

export interface ParlayLegInput {
  p: number;
  americanOdds: number;
  label: string;
}

export interface ParlayEvaluation {
  legs: Array<ParlayLegInput & { s: number; fairS: number; juice: number; edge: number; plusEv: boolean }>;
  p: number;
  s: number;
  evPerUnit: number;
  plusEv: boolean;
  compounds: boolean;
  kellyQuarter: number;
  warning?: string;
}

export interface CalibrationBin {
  predicted: number;
  actual: number;
  n: number;
}

export interface BacktestSummary {
  n: number;
  wins: number;
  empiricalP: number;
  avgS: number;
  units: number;
  roi: number;
  maxDrawdown: number;
  brier: number;
  bins: CalibrationBin[];
  holdoutSeason?: number;
  pickRule?: string;
}
