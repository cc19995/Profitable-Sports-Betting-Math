export const HOUSE_FACTORS = ["running", "passing", "offense", "defense", "ranks"] as const;

export type HouseFactorName = (typeof HOUSE_FACTORS)[number];

export type HouseWeights = Record<HouseFactorName, number>;

export type FactorSide = {
  offense: number;
  defense: number;
};

export type ProcessCard = {
  successOff: number;
  successDef: number;
  explosiveOff: number;
  explosiveDef: number;
  protection: number;
  passRush: number;
  turnoverLuck: number;
  redZoneOff: number;
  redZoneDef: number;
  thirdDownOff: number;
  thirdDownDef: number;
  passRate: number;
};

export type TeamFactors = {
  teamId: string;
  abbreviation: string;
  name: string;
  sampleGames: number;
  asOfSeason: number;
  asOfWeek: number;
  running: FactorSide;
  passing: FactorSide;
  offense: number;
  defense: number;
  ranks: number;
  pace: number;
  source: string;
  process?: ProcessCard;
};

export type HouseModel = {
  name: string;
  league: "nfl" | "ncaaf";
  weights: HouseWeights;
  pointsPerSigma: number;
  description: string;
};

export type FactorLookup = (teamId: string, season: number, week: number) => TeamFactors | undefined;

export type SmartSignalKind = "recommend" | "caution";

export type SmartSignal = {
  id: string;
  label: string;
  kind: SmartSignalKind;
};
