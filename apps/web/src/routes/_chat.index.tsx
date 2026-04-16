import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { APP_BASE_NAME } from "../branding";
import { isElectron } from "../env";
import { useComposerDraftStore } from "../composerDraftStore";
import { normalizeDraftThreadId } from "../lib/routeSearch";
import { SidebarTrigger } from "../components/ui/sidebar";
import { useStore } from "../store";

function ChatIndexRouteView() {
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const draftThreadId = Route.useSearch({
    select: (search) => search.draftThreadId,
  });
  const threadExists = useStore((store) =>
    draftThreadId ? store.threads.some((thread) => thread.id === draftThreadId) : false,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    draftThreadId ? Object.hasOwn(store.draftThreadsByThreadId, draftThreadId) : false,
  );

  useEffect(() => {
    if (!draftThreadId || !threadsHydrated) {
      return;
    }

    if (threadExists && !draftThreadExists) {
      void navigate({
        to: "/$threadId",
        params: { threadId: draftThreadId },
        replace: true,
      });
      return;
    }

    if (draftThreadExists) {
      void navigate({
        to: "/new",
        search: { draftThreadId, context: "global" },
        replace: true,
      });
    }
  }, [draftThreadExists, draftThreadId, navigate, threadExists, threadsHydrated]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Threads</span>
          </div>
        </header>
      )}

      {isElectron && (
        <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-sm font-medium text-foreground">{APP_BASE_NAME}</div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Pick a thread from the sidebar or start a new one to continue.
          </p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  validateSearch: (search: Record<string, unknown>) => {
    const draftThreadId = normalizeDraftThreadId(search.draftThreadId);
    return draftThreadId ? { draftThreadId } : {};
  },
  component: ChatIndexRouteView,
});
