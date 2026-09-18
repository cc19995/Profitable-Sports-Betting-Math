"use client";

import { useEffect, useState } from "react";
import type { ModelSnapshot } from "@/src/data/snapshot";

export function SnapshotLoader({
  children,
}: {
  children: (snapshot: ModelSnapshot) => React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ModelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshot")
      .then(async (response) => {
        const payload = (await response.json()) as ModelSnapshot | { error?: string };
        if (!response.ok) {
          throw new Error("error" in payload && payload.error ? payload.error : "Failed to load snapshot");
        }
        if (!cancelled) {
          setSnapshot(payload as ModelSnapshot);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load snapshot");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/refresh", { method: "POST" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "refresh failed");
      }
      const snap = await fetch("/api/snapshot");
      const next = (await snap.json()) as ModelSnapshot;
      setSnapshot(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (error && !snapshot) {
    return (
      <div className="panel p-5 space-y-3 max-w-2xl">
        <div className="text-lg font-semibold">No model snapshot yet</div>
        <p className="mute text-sm">{error}</p>
        <p className="text-sm">
          The desk prices NFL and NCAA games from opponent-adjusted ratings plus live ESPN market
          lines. Build the snapshot from the terminal with <code>npm run refresh</code>, or try the
          in-browser rebuild.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="px-3 py-2 border border-[var(--accent)] text-[var(--accent)] text-sm disabled:opacity-50"
        >
          {refreshing ? "Rebuilding ratings…" : "Rebuild snapshot"}
        </button>
      </div>
    );
  }

  if (!snapshot) {
    return <div className="mute">Loading snapshot…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-xs mute hover:text-[var(--accent)] disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh data"}
        </button>
      </div>
      {children(snapshot)}
    </div>
  );
}
