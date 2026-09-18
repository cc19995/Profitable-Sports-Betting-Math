import {
  availabilityDiagnostics,
  availabilitySignals,
  buildAvailabilityOverlay,
  decideAvailabilityPick,
  type AvailabilityItem,
} from "./availability";
import { handicapMatchup } from "./matchup";
import { selectTrustedBestBet } from "./picks";
import type { FactorLookup, HouseWeights } from "./rithmm/types";
import type { BoardRow, TeamRating, UpcomingGame } from "./types";

export function priceNcaafGameWithAvailability(args: {
  game: UpcomingGame;
  ratings: TeamRating[];
  items?: AvailabilityItem[];
  factorLookup?: FactorLookup;
  houseWeights?: HouseWeights;
  priceWithHouse?: boolean;
}): BoardRow {
  const items = args.items ?? [];
  if (!Array.isArray(items)) {
    throw new Error("availability items must be an array");
  }
  const overlay = buildAvailabilityOverlay({ items, market: args.game.market });
  const handicapArgs = {
    game: args.game,
    ratings: args.ratings,
    factorLookup: args.factorLookup,
    houseWeights: args.houseWeights,
    priceWithHouse: args.priceWithHouse,
  };
  const baseReport = handicapMatchup(handicapArgs);
  const overlayReport = overlay.applied
    ? handicapMatchup({
        ...handicapArgs,
        qbHome: overlay.qbHome,
        qbAway: overlay.qbAway,
        userHome: overlay.userHome,
        userAway: overlay.userAway,
      })
    : baseReport;
  const report =
    items.length === 0
      ? overlayReport
      : {
          ...overlayReport,
          diagnostics: [...availabilityDiagnostics(overlay), ...overlayReport.diagnostics],
        };
  const basePick = selectTrustedBestBet({ game: args.game, report: baseReport, bestBet: null });
  const overlayPick = selectTrustedBestBet({ game: args.game, report, bestBet: null });
  const decided = decideAvailabilityPick({ basePick, overlayPick });
  const signals = availabilitySignals(overlay, decided.action);
  return {
    game: args.game,
    report: signals.length === 0 ? report : { ...report, signals: [...signals, ...report.signals] },
    bestBet: decided.pick,
  };
}
