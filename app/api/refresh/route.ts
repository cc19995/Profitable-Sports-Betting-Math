import { NextResponse } from "next/server";
import { refreshAll } from "@/src/data/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const snapshot = await refreshAll();
    return NextResponse.json({
      generatedAt: snapshot.generatedAt,
      nfl: {
        ratings: snapshot.nfl.ratings.length,
        board: snapshot.nfl.upcomingCount,
        backtestN: snapshot.nfl.backtest?.n ?? 0,
      },
      ncaaf: {
        ratings: snapshot.ncaaf.ratings.length,
        board: snapshot.ncaaf.upcomingCount,
        backtestN: snapshot.ncaaf.backtest?.n ?? 0,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "refresh failed" },
      { status: 500 },
    );
  }
}
