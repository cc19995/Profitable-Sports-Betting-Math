export function pct(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

export function pts(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

export function american(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

export function evPct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

/** Desk clock: Eastern Time, not the server or browser zone. */
export const DISPLAY_TIME_ZONE = "America/New_York";

function parseIso(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function easternDateParts(iso: string): Intl.DateTimeFormatPart[] | null {
  const date = parseIso(iso);
  if (!date) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
}

export function kickoffLabel(iso: string): string {
  const date = parseIso(iso);
  if (!date) {
    return iso;
  }
  return date.toLocaleString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Eastern calendar day for a kickoff, matching what `kickoffLabel` displays. */
export function kickoffDateKey(iso: string): string | null {
  const parts = easternDateParts(iso);
  if (!parts) {
    return null;
  }
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function kickoffDateLabel(iso: string): string {
  const date = parseIso(iso);
  if (!date) {
    return iso;
  }
  return date.toLocaleDateString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function snapshotClockLabel(iso: string): string {
  return kickoffLabel(iso);
}
