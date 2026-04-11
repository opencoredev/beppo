import type { ThreadId } from "@t3tools/contracts";
import { PauseIcon, SquareIcon } from "lucide-react";
import { useCallback } from "react";

import { cn, newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { useStore } from "~/store";

import { deriveAgentControlState } from "./AgentControls.logic";

const statusVariantClasses: Record<string, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-success/16 text-success",
  warning: "bg-warning/16 text-warning",
  error: "bg-destructive/16 text-destructive",
  info: "bg-info/16 text-info",
};

interface AgentControlsProps {
  threadId: ThreadId;
}

function AgentControls({ threadId }: AgentControlsProps) {
  const thread = useStore((state) => state.threads.find((t) => t.id === threadId));
  const controlState = deriveAgentControlState(thread?.session ?? null);

  const handlePause = useCallback(() => {
    const api = readNativeApi();
    if (!api || !controlState.canPause) return;
    void api.orchestration.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: newCommandId(),
      threadId,
      createdAt: new Date().toISOString(),
    });
  }, [threadId, controlState.canPause]);

  const handleStop = useCallback(() => {
    const api = readNativeApi();
    if (!api || !controlState.canKill) return;
    void api.orchestration.dispatchCommand({
      type: "thread.session.stop",
      commandId: newCommandId(),
      threadId,
      createdAt: new Date().toISOString(),
    });
  }, [threadId, controlState.canKill]);

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          statusVariantClasses[controlState.statusVariant] ?? statusVariantClasses.default,
        )}
      >
        {controlState.statusLabel}
      </span>

      <button
        type="button"
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-md border text-sm transition-transform transition-colors hover:scale-[1.03] active:scale-[0.97]",
          controlState.canPause
            ? "border-input text-foreground hover:bg-accent"
            : "cursor-not-allowed border-transparent text-muted-foreground/48",
        )}
        disabled={!controlState.canPause}
        onClick={handlePause}
        title="Pause agent"
      >
        <PauseIcon className="size-3.5" />
      </button>

      <button
        type="button"
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-md border text-sm transition-transform transition-colors hover:scale-[1.03] active:scale-[0.97]",
          controlState.canKill
            ? "border-input text-destructive hover:bg-destructive/8"
            : "cursor-not-allowed border-transparent text-muted-foreground/48",
        )}
        disabled={!controlState.canKill}
        onClick={handleStop}
        title="Stop agent"
      >
        <SquareIcon className="size-3.5" />
      </button>
    </div>
  );
}

export { AgentControls };
