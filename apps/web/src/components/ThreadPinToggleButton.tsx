import type { ThreadId } from "@t3tools/contracts";
import { PinIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { usePinnedThreadsStore } from "~/pinnedThreadsStore";

export function ThreadPinToggleButton(props: {
  threadId: ThreadId;
  label: string;
  className?: string;
}) {
  const isPinned = usePinnedThreadsStore((state) => state.pinnedThreadIds.includes(props.threadId));
  const togglePinnedThread = usePinnedThreadsStore((state) => state.togglePinnedThread);

  return (
    <button
      type="button"
      data-thread-selection-safe
      aria-label={isPinned ? `Unpin ${props.label}` : `Pin ${props.label}`}
      title={isPinned ? "Unpin thread" : "Pin thread"}
      className={cn(
        "inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        isPinned
          ? "text-primary hover:bg-primary/10 hover:text-primary"
          : "hover:bg-accent hover:text-foreground",
        props.className,
      )}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePinnedThread(props.threadId);
      }}
    >
      <PinIcon className={cn("size-3.5", isPinned ? "fill-current" : "")} />
    </button>
  );
}
