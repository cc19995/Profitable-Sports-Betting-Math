"use client";

import { CombosView } from "../components/CombosView";
import { SnapshotLoader } from "../components/SnapshotLoader";

export default function CombosPage() {
  return (
    <SnapshotLoader>
      {(snapshot) => <CombosView snapshot={snapshot} />}
    </SnapshotLoader>
  );
}
