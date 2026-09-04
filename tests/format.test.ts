import { describe, expect, it } from "vitest";
import { kickoffDateKey, kickoffDateLabel } from "@/src/lib/format";

describe("kickoff date keys", () => {
  it("returns a local YYYY-MM-DD key for a valid kickoff", () => {
    const iso = "2026-09-10T00:20:00Z";
    const key = kickoffDateKey(iso);
    const expected = (() => {
      const date = new Date(iso);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    })();
    expect(key).toBe(expected);
    expect(kickoffDateLabel(iso)).toMatch(/Sep/);
  });

  it("returns null for an invalid timestamp", () => {
    expect(kickoffDateKey("not-a-date")).toBeNull();
  });
});
