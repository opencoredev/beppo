import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveIcon,
  Clock3Icon,
  FolderIcon,
  InfoIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ARCHIVE_RETENTION_DAYS } from "@t3tools/shared/archive";

import { isElectron } from "../env";
import { useComposerDraftStore } from "../composerDraftStore";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { type Project, type Thread } from "../types";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import {
  archiveDeleteAtIso,
  deleteThreadCommand,
  formatCalendarDateTime,
  restoreThreadCommand,
} from "../lib/threadArchive";

interface ArchivedThreadGroup {
  id: string;
  name: string;
  threads: Thread[];
}

type ArchivedThreadId = Thread["id"];

function archivedTimestamp(thread: Thread): number {
  return Date.parse(thread.archivedAt!);
}

function groupArchivedThreads(threads: Thread[], projects: Project[]): ArchivedThreadGroup[] {
  const projectNameById = new Map(projects.map((project) => [project.id, project.name] as const));
  const byProject = new Map<string, ArchivedThreadGroup>();

  for (const thread of threads) {
    const existing = byProject.get(thread.projectId);
    if (existing) {
      existing.threads.push(thread);
      continue;
    }

    byProject.set(thread.projectId, {
      id: thread.projectId,
      name: projectNameById.get(thread.projectId) ?? "Unknown project",
      threads: [thread],
    });
  }

  const groups = [...byProject.values()];
  for (const group of groups) {
    group.threads = group.threads.toSorted(
      (left, right) => archivedTimestamp(right) - archivedTimestamp(left),
    );
  }

  return groups.toSorted(
    (left, right) => archivedTimestamp(right.threads[0]!) - archivedTimestamp(left.threads[0]!),
  );
}

function sameIdSet(left: ReadonlySet<ArchivedThreadId>, right: ReadonlySet<ArchivedThreadId>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function removeIds(
  source: ReadonlySet<ArchivedThreadId>,
  ids: readonly ArchivedThreadId[],
): ReadonlySet<ArchivedThreadId> {
  if (ids.length === 0) {
    return source;
  }
  const next = new Set(source);
  for (const id of ids) {
    next.delete(id);
  }
  return next;
}

function ArchiveRouteView() {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const archivedThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.archivedAt !== null)
        .toSorted((left, right) => archivedTimestamp(right) - archivedTimestamp(left)),
    [threads],
  );
  const archivedGroups = useMemo(
    () => groupArchivedThreads(archivedThreads, projects),
    [archivedThreads, projects],
  );
  const archivedThreadById = useMemo(
    () => new Map(archivedThreads.map((thread) => [thread.id, thread] as const)),
    [archivedThreads],
  );
  const archivedThreadIds = useMemo(
    () => new Set(archivedThreads.map((thread) => thread.id)),
    [archivedThreads],
  );
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalState = useTerminalStateStore((store) => store.clearTerminalState);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<ReadonlySet<ArchivedThreadId>>(
    () => new Set(),
  );
  const [deleteDialogThreadIds, setDeleteDialogThreadIds] = useState<
    readonly ArchivedThreadId[] | null
  >(null);
  const [pendingAction, setPendingAction] = useState<{
    kind: "restore" | "delete";
    ids: readonly ArchivedThreadId[];
  } | null>(null);

  const selectedCount = selectedThreadIds.size;
  const selectedProjectCount = useMemo(() => {
    let count = 0;
    for (const group of archivedGroups) {
      if (group.threads.some((thread) => selectedThreadIds.has(thread.id))) {
        count += 1;
      }
    }
    return count;
  }, [archivedGroups, selectedThreadIds]);
  const deleteDialogThreads = useMemo(
    () =>
      (deleteDialogThreadIds ?? [])
        .map((id) => archivedThreadById.get(id))
        .filter((thread): thread is Thread => thread !== undefined),
    [archivedThreadById, deleteDialogThreadIds],
  );
  const pendingIds = pendingAction?.ids ?? [];
  const isMutating = pendingAction !== null;

  useEffect(() => {
    setSelectedThreadIds((current) => {
      const next = new Set<ArchivedThreadId>();
      for (const id of current) {
        if (archivedThreadIds.has(id)) {
          next.add(id);
        }
      }
      return sameIdSet(current, next) ? current : next;
    });
  }, [archivedThreadIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setIsShiftPressed(false);
      }
    };

    const handleBlur = () => {
      setIsShiftPressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedThreadIds(new Set());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleThreadSelection = useCallback(
    (threadId: ArchivedThreadId, checked: boolean) => {
      setSelectedThreadIds((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(threadId);
        } else {
          next.delete(threadId);
        }
        return next;
      });
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedThreadIds(new Set());
  }, []);

  const performRestore = useCallback(
    async (threadIds: readonly ArchivedThreadId[]) => {
      if (threadIds.length === 0) {
        return;
      }

      const api = readNativeApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Archive controls unavailable",
        });
        return;
      }

      setPendingAction({ kind: "restore", ids: threadIds });
      try {
        const restoredIds: ArchivedThreadId[] = [];
        let failedCount = 0;

        for (const threadId of threadIds) {
          try {
            await restoreThreadCommand(api, threadId);
            restoredIds.push(threadId);
          } catch {
            failedCount += 1;
          }
        }

        if (restoredIds.length > 0) {
          toastManager.add({
            type: "success",
            title:
              restoredIds.length === 1
                ? "Thread restored"
                : `${restoredIds.length} archived chats restored`,
          });
          setSelectedThreadIds((current) => removeIds(current, restoredIds));
        }

        if (failedCount > 0) {
          toastManager.add({
            type: "error",
            title:
              failedCount === 1
                ? "Failed to restore 1 archived chat"
                : `Failed to restore ${failedCount} archived chats`,
          });
        }
      } finally {
        setPendingAction(null);
      }
    },
    [],
  );

  const openDeleteDialog = useCallback((threadIds: readonly ArchivedThreadId[]) => {
    if (threadIds.length === 0) {
      return;
    }
    setDeleteDialogThreadIds([...threadIds]);
  }, []);

  const handleDeleteButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, threadId: ArchivedThreadId) => {
      if (event.shiftKey || isShiftPressed) {
        toggleThreadSelection(threadId, !selectedThreadIds.has(threadId));
        return;
      }

      if (selectedThreadIds.has(threadId) && selectedThreadIds.size > 1) {
        openDeleteDialog([...selectedThreadIds]);
        return;
      }

      openDeleteDialog([threadId]);
    },
    [isShiftPressed, openDeleteDialog, selectedThreadIds, toggleThreadSelection],
  );

  const closeDeleteDialog = useCallback(() => {
    if (pendingAction?.kind === "delete") {
      return;
    }
    setDeleteDialogThreadIds(null);
  }, [pendingAction]);

  const confirmDelete = useCallback(async () => {
    if (!deleteDialogThreadIds || deleteDialogThreadIds.length === 0) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Archive controls unavailable",
      });
      return;
    }

    setPendingAction({ kind: "delete", ids: deleteDialogThreadIds });
    try {
      const deletedIds: ArchivedThreadId[] = [];
      let failedCount = 0;

      for (const threadId of deleteDialogThreadIds) {
        const thread = archivedThreadById.get(threadId);
        if (!thread) {
          continue;
        }
        try {
          await deleteThreadCommand(api, thread);
          clearComposerDraftForThread(thread.id);
          clearProjectDraftThreadById(thread.projectId, thread.id);
          clearTerminalState(thread.id);
          deletedIds.push(thread.id);
        } catch {
          failedCount += 1;
        }
      }

      if (deletedIds.length > 0) {
        toastManager.add({
          type: "success",
          title:
            deletedIds.length === 1
              ? "Archived chat deleted"
              : `${deletedIds.length} archived chats deleted`,
        });
        setSelectedThreadIds((current) => removeIds(current, deletedIds));
      }

      if (failedCount > 0) {
        toastManager.add({
          type: "error",
          title:
            failedCount === 1
              ? "Failed to delete 1 archived chat"
              : `Failed to delete ${failedCount} archived chats`,
        });
      }

      setDeleteDialogThreadIds(null);
    } finally {
      setPendingAction(null);
    }
  }, [
    archivedThreadById,
    clearComposerDraftForThread,
    clearProjectDraftThreadById,
    clearTerminalState,
    deleteDialogThreadIds,
  ]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Archived chats</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Archived chats
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Archived chats
              </h1>
              <p className="text-sm text-muted-foreground">
                Review archived chats, restore them to the main sidebar, or permanently remove them
                before the {ARCHIVE_RETENTION_DAYS}-day retention window ends.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Archive overview</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  This page follows the same card layout as settings and gives you bulk control over
                  archived chats.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-background px-3 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Archived now</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">
                      {archivedThreads.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-background px-3 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Projects</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">
                      {archivedGroups.length}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-background px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Clock3Icon className="size-4 text-muted-foreground" />
                        Auto-delete after {ARCHIVE_RETENTION_DAYS} days
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Archived chats remain recoverable until the retention window ends.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCount > 0 ? (
                        <>
                          <Badge variant="secondary" size="sm">
                            {selectedCount} queued
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={clearSelection}
                            disabled={isMutating}
                          >
                            <XIcon data-icon="inline-start" />
                            Clear
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        {selectedCount > 0
                          ? `Hold Shift and click more Delete permanently buttons to queue additional chats. Click Delete permanently on any queued chat to confirm batch deletion. Press Escape to clear.`
                          : "Hold Shift and click Delete permanently on multiple chats to queue them for one batch delete."}
                      </p>
                    </div>
                    {selectedCount > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {selectedProjectCount} {selectedProjectCount === 1 ? "project" : "projects"}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {!threadsHydrated ? (
              <section className="rounded-2xl border border-border bg-card p-5">
                <div className="flex min-h-[220px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">Loading archived chats...</p>
                </div>
              </section>
            ) : archivedGroups.length === 0 ? (
              <section className="rounded-2xl border border-border bg-card p-5">
                <Empty className="min-h-[280px]">
                  <EmptyMedia variant="icon">
                    <ArchiveIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>No archived chats</EmptyTitle>
                    <EmptyDescription>
                      Archive a thread from the sidebar and it will show up here for restore or
                      permanent deletion.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigate({ to: "/" });
                    }}
                  >
                    Back to chats
                  </Button>
                </Empty>
              </section>
            ) : (
              archivedGroups.map((group) => {
                const selectedGroupCount = group.threads.filter((thread) =>
                  selectedThreadIds.has(thread.id),
                ).length;
                return (
                  <section key={group.id} className="rounded-2xl border border-border bg-card p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FolderIcon className="size-4 text-muted-foreground" />
                          <h2 className="text-sm font-medium text-foreground">{group.name}</h2>
                          <Badge variant="secondary" size="sm">
                            {group.threads.length}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {selectedGroupCount > 0
                            ? `${selectedGroupCount} selected in this project`
                            : `${group.threads.length} archived chats in this project`}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {group.threads.map((thread) => {
                        const deleteAt = archiveDeleteAtIso(thread.archivedAt ?? thread.createdAt);
                        const isSelected = selectedThreadIds.has(thread.id);
                        const isPending = pendingIds.includes(thread.id);

                        return (
                          <article
                            key={thread.id}
                            className={`rounded-lg border px-3 py-3 transition-colors ${
                              isSelected
                                ? "border-primary/60 bg-primary/6"
                                : "border-border bg-background"
                            }`}
                          >
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="truncate text-sm font-medium text-foreground">
                                      {thread.title}
                                    </h3>
                                    <Badge
                                      variant={isSelected ? "secondary" : "outline"}
                                      size="sm"
                                    >
                                      <ArchiveIcon />
                                      {isSelected ? "Queued" : "Archived"}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                    <span>
                                      Archived{" "}
                                      {formatCalendarDateTime(thread.archivedAt ?? thread.createdAt)}
                                    </span>
                                    <span>
                                      Deletes {formatCalendarDateTime(deleteAt)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 sm:ml-auto">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void performRestore([thread.id])}
                                  disabled={isMutating}
                                >
                                  <RotateCcwIcon data-icon="inline-start" />
                                  {pendingAction?.kind === "restore" && isPending
                                    ? "Restoring..."
                                    : "Restore"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant={isSelected ? "destructive" : "destructive-outline"}
                                  onClick={(event) => handleDeleteButtonClick(event, thread.id)}
                                  disabled={isMutating}
                                >
                                  <Trash2Icon data-icon="inline-start" />
                                  {isSelected ? "Queued for delete" : "Delete permanently"}
                                </Button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={deleteDialogThreadIds !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteDialogThreads.length > 1 ? "Delete archived chats" : "Delete archived chat"}
            </DialogTitle>
            <DialogDescription>
              This permanently removes the selected archived conversation
              {deleteDialogThreads.length === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="rounded-lg border border-border bg-background px-3 py-3">
              <div className="text-sm font-medium text-foreground">
                {deleteDialogThreads.length} selected
              </div>
              <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                {deleteDialogThreads.slice(0, 5).map((thread) => (
                  <span key={thread.id}>{thread.title}</span>
                ))}
                {deleteDialogThreads.length > 5 ? (
                  <span>and {deleteDialogThreads.length - 5} more...</span>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              They would otherwise auto-delete after {ARCHIVE_RETENTION_DAYS} days.
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={pendingAction?.kind === "delete"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteDialogThreads.length === 0 || pendingAction?.kind === "delete"}
            >
              {pendingAction?.kind === "delete" ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/archive")({
  component: ArchiveRouteView,
});
