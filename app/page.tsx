import { BoardView } from "./components/BoardView";
import { SnapshotLoader } from "./components/SnapshotLoader";

export default function HomePage() {
  return (
    <SnapshotLoader>
      {(snapshot) => <BoardView snapshot={snapshot} />}
    </SnapshotLoader>
  );
}
