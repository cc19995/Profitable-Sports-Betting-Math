import { NextResponse } from "next/server";
import { readSnapshot } from "@/src/data/loadSnapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: "No snapshot yet. Run npm run refresh." }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
