import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export async function cachedDownload(args: {
  url: string;
  fileName: string;
  ttlMs?: number;
}): Promise<string> {
  if (typeof args.url !== "string" || args.url.length === 0) {
    throw new Error("download url is required");
  }
  if (typeof args.fileName !== "string" || args.fileName.length === 0) {
    throw new Error("download fileName is required");
  }
  const dest = path.join(process.cwd(), "data", "cache", args.fileName);
  await mkdir(path.dirname(dest), { recursive: true });
  const existing = await stat(dest).catch(() => null);
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  if (existing && Date.now() - existing.mtimeMs < ttl) {
    return dest;
  }
  const response = await fetch(args.url, { headers: { Accept: "text/csv,*/*" } });
  if (!response.ok) {
    if (existing) {
      return dest;
    }
    throw new Error(`download failed ${response.status} for ${args.url}`);
  }
  await writeFile(dest, await response.text());
  return dest;
}
