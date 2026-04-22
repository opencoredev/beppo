import { scopeThreadRef } from "@t3tools/client-runtime";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { APP_BASE_NAME } from "../branding";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { normalizeDraftThreadId } from "../lib/routeSearch";
import { selectThreadExistsByRef, useStore } from "../store";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { SidebarTrigger } from "../components/ui/sidebar";

function ChatIndexRouteView() {
  const navigate = useNavigate();
  const activeEnvironmentId = useStore((store) => store.activeEnvironmentId);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const draftThreadId = Route.useSearch({
    select: (search) => search.draftThreadId,
  });
  const threadRef = useMemo(
    () =>
      activeEnvironmentId && draftThreadId
        ? scopeThreadRef(activeEnvironmentId, draftThreadId)
        : null,
    [activeEnvironmentId, draftThreadId],
  );
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const draftSessionId = useComposerDraftStore((store) => {
    if (!threadRef) {
      return null;
    }

    const matchingDraftEntry = Object.entries(store.draftThreadsByThreadKey).find(
      ([, draftThread]) =>
        draftThread.environmentId === threadRef.environmentId &&
        draftThread.threadId === threadRef.threadId,
    );
    return (matchingDraftEntry?.[0] as DraftId | undefined) ?? null;
  });

  useEffect(() => {
    if (!draftThreadId || !threadsHydrated || !threadRef) {
      return;
    }

    if (threadExists && !draftSessionId) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        replace: true,
      });
      return;
    }

    if (draftSessionId) {
      void navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(draftSessionId),
        replace: true,
      });
    }
  }, [draftSessionId, draftThreadId, navigate, threadExists, threadRef, threadsHydrated]);

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
