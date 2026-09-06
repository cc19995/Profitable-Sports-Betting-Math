"use client";

import { BestBetsView } from "../components/BestBetsView";
import { SnapshotLoader } from "../components/SnapshotLoader";

export default function BestBetsPage() {
  return (
    <SnapshotLoader>
      {(snapshot) => <BestBetsView snapshot={snapshot} />}
    </SnapshotLoader>
  );
}
