import { DEFAULT_RUNTIME_MODE } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import ChatView from "../components/ChatView";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { APP_BASE_NAME } from "../branding";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { ensureProjectDraftThread, preferredProjectIdForNewThread } from "../lib/draftThreads";
import { normalizeDraftThreadId } from "../lib/routeSearch";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";

type DraftContext = "global" | "project";

function normalizeDraftContext(value: unknown): DraftContext {
  return value === "project" ? "project" : "global";
}

function NewThreadRouteView() {
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const { context: draftContext, draftThreadId } = Route.useSearch({
    select: (search) => ({
      context: search.context ?? "global",
      draftThreadId: search.draftThreadId,
    }),
  });
  const getDraftThreadByProjectId = useComposerDraftStore((store) => store.getDraftThreadByProjectId);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const threadExists = useStore((store) =>
    draftThreadId ? store.threads.some((thread) => thread.id === draftThreadId) : false,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    draftThreadId ? Object.hasOwn(store.draftThreadsByThreadId, draftThreadId) : false,
  );
  const preferredProjectId = useMemo(
    () => preferredProjectIdForNewThread({ projects, threads }),
    [projects, threads],
  );

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!draftThreadId) {
      if (!preferredProjectId) {
        return;
      }

      const nextDraftThreadId = ensureProjectDraftThread({
        projectId: preferredProjectId,
        routeThreadId: null,
        getDraftThreadByProjectId,
        getDraftThread,
        setDraftThreadContext,
        setProjectDraftThreadId,
        clearProjectDraftThreadId,
        createThreadId: newThreadId,
        options: {
          createdAt: new Date().toISOString(),
          envMode: "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        },
      });
      void navigate({
        to: "/new",
        search: { draftThreadId: nextDraftThreadId, context: "global" },
        replace: true,
      });
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

    if (!threadExists && !draftThreadExists) {
      void navigate({
        to: "/new",
        search: {},
        replace: true,
      });
    }
  }, [
    clearProjectDraftThreadId,
    draftThreadExists,
    draftThreadId,
    getDraftThread,
    getDraftThreadByProjectId,
    navigate,
    preferredProjectId,
    setDraftThreadContext,
    setProjectDraftThreadId,
    threadExists,
    threadsHydrated,
  ]);

  if (draftThreadId && (draftThreadExists || threadExists)) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          key={draftThreadId}
          threadId={draftThreadId}
          draftSurface={draftContext === "global" ? "global" : "project"}
        />
      </SidebarInset>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
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
          <span className="text-xs text-muted-foreground/50">New thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm text-foreground">
            {preferredProjectId
              ? `Preparing a new ${APP_BASE_NAME} thread...`
              : "Add a project to start a new thread."}
          </p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/new")({
  validateSearch: (search: Record<string, unknown>) => {
    const draftThreadId = normalizeDraftThreadId(search.draftThreadId);
    const context = normalizeDraftContext(search.context);
    return draftThreadId ? { draftThreadId, context } : {};
  },
  component: NewThreadRouteView,
});
