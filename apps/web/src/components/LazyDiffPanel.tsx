import DiffPanel from "./DiffPanel";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { type DiffPanelMode } from "./DiffPanelShell";

export default function LazyDiffPanel({ mode }: { mode: DiffPanelMode }) {
  return (
    <DiffWorkerPoolProvider>
      <DiffPanel mode={mode} />
    </DiffWorkerPoolProvider>
  );
}
