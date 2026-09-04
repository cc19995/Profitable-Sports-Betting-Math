import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelSnapshot } from "./snapshot";

export async function readSnapshot(): Promise<ModelSnapshot | null> {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "snapshot.json"), "utf8");
    return JSON.parse(raw) as ModelSnapshot;
  } catch {
    return null;
  }
}
