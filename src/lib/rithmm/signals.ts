import type { League, PricedSide } from "../types";
import type { SmartSignal, TeamFactors } from "./types";

export function alignmentFromGaps(args: {
  betType: PricedSide["betType"];
  spreadGap?: number;
  totalGap?: number;
}): number {
  if (args.betType === "total") {
    if (args.totalGap === undefined) return 0.55;
    const abs = Math.abs(args.totalGap);
    if (abs <= 4) return 1;
    if (abs <= 8) return 0.8;
    if (abs <= 12) return 0.42;
    return 0.15;
  }
  if (args.spreadGap === undefined) return 0.5;
  const abs = Math.abs(args.spreadGap);
  if (args.betType === "spread") {
    if (abs <= 3.5) return 1;
    if (abs <= 7) return 0.82;
    if (abs <= 11) return 0.4;
    return 0.12;
  }
  if (abs <= 4) return 0.95;
  if (abs <= 8) return 0.7;
  return 0.18;
}

export function houseSignals(args: {
  league: League;
  home: TeamFactors;
  away: TeamFactors;
  pick: PricedSide;
  alignment: number;
}): SmartSignal[] {
  const signals: SmartSignal[] = [];
  const pace = (args.home.pace + args.away.pace) / 2;
  const rankGap = Math.abs(args.home.ranks - args.away.ranks);
  const passMismatch = Math.abs(args.home.passing.offense - args.away.passing.defense);

  if (args.alignment >= 0.8 && args.pick.betType !== "moneyline") {
    signals.push({
      id: "aligned-market",
      label: "Projection sits close to the market (alignment ≥ 0.8)",
      kind: "recommend",
    });
  }
  if (args.pick.betType === "total" && args.pick.side === "under" && pace > 0 && pace < (args.league === "nfl" ? 58 : 66)) {
    signals.push({
      id: "slow-under",
      label: "Both offenses play slow — under setup the house model is built to see",
      kind: "recommend",
    });
  }
  if (args.pick.betType === "spread" && passMismatch >= 18 && args.alignment >= 0.8) {
    signals.push({
      id: "pass-fit",
      label: "Clear pass-offense vs pass-defense mismatch",
      kind: "recommend",
    });
  }
  if (rankGap >= 30 && args.alignment < 0.5) {
    signals.push({
      id: "rank-fight",
      label: "Huge rank gap but the number already prices it — caution",
      kind: "caution",
    });
  }
  if (args.home.sampleGames < 4 || args.away.sampleGames < 4) {
    signals.push({
      id: "thin-sample",
      label: "Thin EPA sample — house factors are noisy",
      kind: "caution",
    });
  }
  const hp = args.home.process;
  const ap = args.away.process;
  if (hp && ap) {
    const pressureGap = Math.abs(hp.passRush - ap.protection) + Math.abs(ap.passRush - hp.protection);
    if (args.pick.betType === "spread" && pressureGap >= 36 && args.alignment >= 0.8) {
      signals.push({
        id: "pressure-fit",
        label: "Pass-rush vs protection mismatch",
        kind: "recommend",
      });
    }
    if (hp.turnoverLuck >= 62 || ap.turnoverLuck >= 62) {
      signals.push({
        id: "fumble-luck",
        label: "Fumble recovery rate is unsustainably high — faded, not a talent edge",
        kind: "caution",
      });
    }
  }
  return signals;
}
