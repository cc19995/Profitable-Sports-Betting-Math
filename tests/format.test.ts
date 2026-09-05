import { describe, expect, it } from "vitest";
import { kickoffDateKey, kickoffDateLabel, kickoffLabel } from "@/src/lib/format";

describe("kickoff date keys", () => {
  it("pins a late Saturday Eastern kickoff to Saturday, not Sunday UTC", () => {
    const iso = "2026-09-06T02:30:00.000Z";
    expect(kickoffDateKey(iso)).toBe("2026-09-05");
    expect(kickoffDateLabel(iso)).toBe("Sat, Sep 5");
    expect(kickoffLabel(iso)).toBe("Sat, Sep 5, 10:30 PM EDT");
  });

  it("maps a 6:00 PM Eastern Saturday kickoff to Sep 5", () => {
    const iso = "2026-09-05T22:00:00.000Z";
    expect(kickoffDateKey(iso)).toBe("2026-09-05");
    expect(kickoffLabel(iso)).toBe("Sat, Sep 5, 6:00 PM EDT");
  });

  it("uses EST after daylight saving ends", () => {
    const iso = "2026-01-11T01:00:00.000Z";
    expect(kickoffDateKey(iso)).toBe("2026-01-10");
    expect(kickoffLabel(iso)).toBe("Sat, Jan 10, 8:00 PM EST");
  });

  it("returns null for an invalid timestamp", () => {
    expect(kickoffDateKey("not-a-date")).toBeNull();
    expect(kickoffLabel("not-a-date")).toBe("not-a-date");
    expect(kickoffDateLabel("not-a-date")).toBe("not-a-date");
  });
});
