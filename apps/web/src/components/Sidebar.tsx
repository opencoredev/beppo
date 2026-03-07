import {
  ArchiveIcon,
  ChevronRightIcon,
  FolderIcon,
  GitPullRequestIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMatch, useNavigate, useParams } from "@tanstack/react-router";
import { useAppSettings } from "../appSettings";
import { isElectron } from "../env";
import {
  archiveThreadCommand,
  deleteThreadCommand,
  restoreThreadCommand,
} from "../lib/threadArchive";
import { newCommandId, newProjectId, newThreadId } from "../lib/utils";
import { ensureProjectDraftThread, preferredProjectIdForNewThread } from "../lib/draftThreads";
import { useStore } from "../store";
import { isChatNewLocalShortcut, isChatNewShortcut, shortcutLabelForCommand } from "../keybindings";
import { type Thread } from "../types";
import { derivePendingApprovals } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { type DraftThreadEnvMode, useComposerDraftStore } from "../composerDraftStore";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
} from "./ui/sidebar";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import beppoSidebarLogo from "../../../../full-logo.png";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;
async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard API unavailable.");
  }
  await navigator.clipboard.writeText(text);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface ThreadStatusPill {
  label: "Working" | "Connecting" | "Completed" | "Pending Approval";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

type ThreadPr = GitStatusResult["pr"];

type ThreadActionDialogState =
  {
    kind: "delete-archived";
    threadId: ThreadId;
    canDeleteWorktree: boolean;
    orphanedWorktreePath: string | null;
    displayWorktreePath: string | null;
  };

function hasUnseenCompletion(thread: Thread): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

function threadStatusPill(thread: Thread, hasPendingApprovals: boolean): ThreadStatusPill | null {
  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

/**
 * Derives the server's HTTP origin (scheme + host + port) from the same
 * sources WsTransport uses, converting ws(s) to http(s).
 */
function getServerHttpOrigin(): string {
  const bridgeUrl = window.desktopBridge?.getWsUrl();
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsUrl =
    bridgeUrl && bridgeUrl.length > 0
      ? bridgeUrl
      : envUrl && envUrl.length > 0
        ? envUrl
        : `ws://${window.location.hostname}:${window.location.port}`;
  // Parse to extract just the origin, dropping path/query (e.g. ?token=…)
  const httpUrl = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  try {
    return new URL(httpUrl).origin;
  } catch {
    return httpUrl;
  }
}

const serverHttpOrigin = getServerHttpOrigin();

function ProjectFavicon({ cwd }: { cwd: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  const src = `${serverHttpOrigin}/api/project-favicon?cwd=${encodeURIComponent(cwd)}`;

  if (status === "error") {
    return <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/50" />;
  }

  return (
    <img
      src={src}
      alt=""
      className={`size-3.5 shrink-0 rounded-sm object-contain ${status === "loading" ? "hidden" : ""}`}
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );
}

export default function Sidebar() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearThreadDraft);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const setProjectDraftThreadId = useComposerDraftStore((store) => store.setProjectDraftThreadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const navigate = useNavigate();
  const { settings: appSettings } = useAppSettings();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const isArchiveRoute =
    useMatch({
      from: "/_chat/archive",
      shouldThrow: false,
    }) !== null;
  const isSettingsRoute =
    useMatch({
      from: "/_chat/settings",
      shouldThrow: false,
    }) !== null;
  const preferredProjectId = useMemo(
    () =>
      preferredProjectIdForNewThread({
        projects,
        threads,
      }),
    [projects, threads],
  );
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [threadActionDialog, setThreadActionDialog] = useState<ThreadActionDialogState | null>(null);
  const [deleteArchivedWorktree, setDeleteArchivedWorktree] = useState(false);
  const [isThreadActionPending, setIsThreadActionPending] = useState(false);
  const pendingApprovalByThreadId = useMemo(() => {
    const map = new Map<ThreadId, boolean>();
    for (const thread of threads) {
      map.set(thread.id, derivePendingApprovals(thread.activities).length > 0);
    }
    return map;
  }, [threads]);
  const dialogThread = useMemo(
    () => (threadActionDialog ? threads.find((thread) => thread.id === threadActionDialog.threadId) ?? null : null),
    [threadActionDialog, threads],
  );
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const threadId = ensureProjectDraftThread({
        projectId,
        routeThreadId,
        getDraftThreadByProjectId,
        getDraftThread,
        setDraftThreadContext,
        setProjectDraftThreadId,
        clearProjectDraftThreadId,
        createThreadId: newThreadId,
        options: {
          createdAt: new Date().toISOString(),
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        },
      });
      return navigate({
        to: "/new",
        search: { draftThreadId: threadId, context: "project" },
      });
    },
    [
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      navigate,
      getDraftThread,
      routeThreadId,
      setDraftThreadContext,
      setProjectDraftThreadId,
    ],
  );

  const handleTopLevelNewThread = useCallback(() => {
    if (!preferredProjectId) {
      setAddingProject(true);
      return;
    }

    const threadId = ensureProjectDraftThread({
      projectId: preferredProjectId,
      routeThreadId,
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
      search: { draftThreadId: threadId, context: "global" },
    });
  }, [
    clearProjectDraftThreadId,
    getDraftThread,
    getDraftThreadByProjectId,
    navigate,
    preferredProjectId,
    routeThreadId,
    setDraftThreadContext,
    setProjectDraftThreadId,
  ]);

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = threads
        .filter((thread) => thread.projectId === projectId)
        .toSorted((a, b) => {
          const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          if (byDate !== 0) return byDate;
          return b.id.localeCompare(a.id);
        })[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [navigate, threads],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      const projectCreated = await api.orchestration
        .dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          createdAt,
        })
        .then(() => true)
        .catch(() => false);
      if (projectCreated) {
        await handleNewThread(projectId).catch(() => undefined);
      }
      finishAddingProject();
    },
    [focusMostRecentThreadForProject, handleNewThread, isAddingProject, projects],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const handlePickFolder = async () => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath);
    }
    setIsPickingFolder(false);
  };

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  const navigateToThreadFallback = useCallback(
    (threadId: ThreadId) => {
      if (routeThreadId !== threadId) {
        return;
      }

      const fallbackThreadId =
        threads
          .filter((entry) => entry.id !== threadId && entry.archivedAt === null)
          .reduce<Thread | null>((latest, entry) => {
            if (!latest) {
              return entry;
            }
            const latestAt = Date.parse(latest.lastVisitedAt ?? latest.createdAt);
            const entryAt = Date.parse(entry.lastVisitedAt ?? entry.createdAt);
            if (Number.isNaN(entryAt)) {
              return latest;
            }
            if (Number.isNaN(latestAt) || entryAt > latestAt) {
              return entry;
            }
            return latest;
          }, null)
          ?.id ?? null;
      if (fallbackThreadId) {
        void navigate({
          to: "/$threadId",
          params: { threadId: fallbackThreadId },
          replace: true,
        });
        return;
      }

      void navigate({ to: "/", replace: true });
    },
    [navigate, routeThreadId, threads],
  );

  const deleteThread = useCallback(
    async (thread: Thread, options?: { deleteWorktree?: boolean }) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      const threadProject = projects.find((project) => project.id === thread.projectId);
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(threads, thread.id);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;

      await deleteThreadCommand(api, thread);
      clearComposerDraftForThread(thread.id);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(thread.id);
      navigateToThreadFallback(thread.id);

      if (
        !options?.deleteWorktree ||
        !orphanedWorktreePath ||
        !threadProject
      ) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId: thread.id,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigateToThreadFallback,
      projects,
      removeWorktreeMutation,
      threads,
    ],
  );

  const archiveThread = useCallback(
    async (thread: Thread) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      await archiveThreadCommand(api, thread);
      navigateToThreadFallback(thread.id);
    },
    [navigateToThreadFallback],
  );

  const restoreThread = useCallback(async (thread: Thread) => {
    const api = readNativeApi();
    if (!api) {
      return;
    }

    await restoreThreadCommand(api, thread.id);
  }, []);

  const handleArchiveAction = useCallback(
    async (thread: Thread) => {
      await archiveThread(thread);
      toastManager.add({
        type: "success",
        title: "Thread archived",
        description: `"${thread.title}" moved to Archived chats.`,
      });
    },
    [archiveThread],
  );

  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const clicked = await api.contextMenu.show(
        thread.archivedAt === null
          ? [
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              { id: "copy-thread-id", label: "Copy Thread ID" },
              { id: "archive", label: "Archive" },
              { id: "delete", label: "Delete", destructive: true },
            ]
          : [
              { id: "restore", label: "Restore" },
              { id: "copy-thread-id", label: "Copy Thread ID" },
              { id: "delete-archived", label: "Delete permanently", destructive: true },
            ],
        position,
      );

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "copy-thread-id") {
        try {
          await copyTextToClipboard(threadId);
          toastManager.add({
            type: "success",
            title: "Thread ID copied",
            description: threadId,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to copy thread ID",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "archive") {
        await handleArchiveAction(thread).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        });
        return;
      }
      if (clicked === "restore") {
        await restoreThread(thread).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Failed to restore thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        });
        return;
      }
      if (clicked === "delete-archived") {
        const orphanedWorktreePath = getOrphanedWorktreePathForThread(threads, threadId);
        setDeleteArchivedWorktree(false);
        setThreadActionDialog({
          kind: "delete-archived",
          threadId,
          canDeleteWorktree: orphanedWorktreePath !== null,
          orphanedWorktreePath,
          displayWorktreePath: orphanedWorktreePath
            ? formatWorktreePathForDisplay(orphanedWorktreePath)
            : null,
        });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(threads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const threadProject = projects.find((project) => project.id === thread.projectId);
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));
      await deleteThread(thread, { deleteWorktree: shouldDeleteWorktree }).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to delete thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [
      appSettings.confirmThreadDelete,
      deleteThread,
      handleArchiveAction,
      markThreadUnread,
      projects,
      restoreThread,
      threads,
    ],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [{ id: "delete", label: "Delete", destructive: true }],
        position,
      );
      if (clicked !== "delete") return;

      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const projectThreads = threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before deleting it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(
        [`Delete project "${project.name}"?`, "This action cannot be undone."].join("\n"),
      );
      if (!confirmed) return;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error deleting project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to delete "${project.name}"`,
          description: message,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      projects,
      threads,
    ],
  );

  const closeThreadActionDialog = useCallback(() => {
    if (isThreadActionPending) {
      return;
    }
    setThreadActionDialog(null);
    setDeleteArchivedWorktree(false);
  }, [isThreadActionPending]);

  const confirmThreadActionDialog = useCallback(async () => {
    if (!threadActionDialog || !dialogThread || isThreadActionPending) {
      return;
    }

    setIsThreadActionPending(true);
    try {
      await deleteThread(dialogThread, { deleteWorktree: deleteArchivedWorktree });
      toastManager.add({
        type: "success",
        title: "Archived thread deleted",
      });
      setThreadActionDialog(null);
      setDeleteArchivedWorktree(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to delete archived thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsThreadActionPending(false);
    }
  }, [
    deleteArchivedWorktree,
    deleteThread,
    dialogThread,
    isThreadActionPending,
    threadActionDialog,
  ]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const activeThread = routeThreadId
        ? threads.find((thread) => thread.id === routeThreadId)
        : undefined;
      const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
      if (isChatNewLocalShortcut(event, keybindings)) {
        const projectId =
          activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
        if (!projectId) return;
        event.preventDefault();
        void handleNewThread(projectId);
        return;
      }

      if (!isChatNewShortcut(event, keybindings)) return;
      const projectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;
      event.preventDefault();
      void handleNewThread(projectId, {
        branch: activeThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: activeThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode: activeDraftThread?.envMode ?? (activeThread?.worktreePath ? "worktree" : "local"),
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [getDraftThread, handleNewThread, keybindings, projects, routeThreadId, threads]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "chat.newLocal") ??
      shortcutLabelForCommand(keybindings, "chat.new"),
    [keybindings],
  );

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const renderThreadItem = useCallback(
    (thread: Thread) => {
      const isActive = routeThreadId === thread.id;
      const isArchived = thread.archivedAt !== null;
      const threadStatus = isArchived
        ? null
        : threadStatusPill(thread, pendingApprovalByThreadId.get(thread.id) === true);
      const prStatus = isArchived ? null : prStatusIndicator(prByThreadId.get(thread.id) ?? null);
      const terminalStatus = isArchived
        ? null
        : terminalStatusFromRunningIds(
            selectThreadTerminalState(terminalStateByThreadId, thread.id).runningTerminalIds,
          );
      const timestamp = isArchived ? thread.archivedAt ?? thread.createdAt : thread.createdAt;

      return (
        <SidebarMenuSubItem key={thread.id} className="group/thread-item w-full">
          <SidebarMenuSubButton
            render={<div role="button" tabIndex={0} />}
            size="sm"
            isActive={isActive}
            className={`relative h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left hover:bg-accent hover:text-foreground ${
              isActive
                ? "bg-accent/85 text-foreground font-medium ring-1 ring-border/70 dark:bg-accent/55 dark:ring-border/50"
                : isArchived
                  ? "text-muted-foreground/80"
                  : "text-muted-foreground"
            }`}
            onClick={() => {
              void navigate({
                to: "/$threadId",
                params: { threadId: thread.id },
              });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              void navigate({
                to: "/$threadId",
                params: { threadId: thread.id },
              });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              void handleThreadContextMenu(thread.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {prStatus && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={prStatus.tooltip}
                        className={`inline-flex cursor-pointer items-center justify-center rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring ${prStatus.colorClass}`}
                        onClick={(event) => {
                          openPrLink(event, prStatus.url);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.stopPropagation();
                          }
                        }}
                      >
                        <GitPullRequestIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                </Tooltip>
              )}
              {threadStatus && (
                <span className={`inline-flex items-center gap-1 text-[10px] ${threadStatus.colorClass}`}>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                      threadStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="hidden md:inline">{threadStatus.label}</span>
                </span>
              )}
              {isArchived && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                  <ArchiveIcon className="size-2.5" />
                  Archived
                </span>
              )}
              {renamingThreadId === thread.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingInputRef.current !== el) {
                      renamingInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
                  value={renamingTitle}
                  onChange={(e) => setRenamingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      void commitRename(thread.id, renamingTitle, thread.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingCommittedRef.current) {
                      void commitRename(thread.id, renamingTitle, thread.title);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs">{thread.title}</span>
              )}
            </div>
            {isArchived ? (
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <span
                  className={`text-[10px] ${
                    isActive ? "text-foreground/65" : "text-muted-foreground/40"
                  }`}
                >
                  {formatRelativeTime(timestamp)}
                </span>
              </div>
            ) : (
              <div className="relative ml-auto flex h-5 w-[4.75rem] shrink-0 items-center justify-end">
                <div className="absolute inset-0 flex items-center justify-end gap-1.5 transition-[opacity,transform] duration-200 ease-out group-focus-within/thread-item:translate-x-1 group-focus-within/thread-item:opacity-0 group-hover/thread-item:translate-x-1 group-hover/thread-item:opacity-0">
                  {terminalStatus && (
                    <span
                      role="img"
                      aria-label={terminalStatus.label}
                      title={terminalStatus.label}
                      className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                    >
                      <TerminalIcon
                        className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                      />
                    </span>
                  )}
                  <span
                    className={`text-[10px] ${
                      isActive ? "text-foreground/65" : "text-muted-foreground/40"
                    }`}
                  >
                    {formatRelativeTime(timestamp)}
                  </span>
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Archive ${thread.title}`}
                        title="Archive thread"
                        className="absolute top-1/2 right-0 inline-flex h-5 -translate-y-1/2 translate-x-1 cursor-pointer items-center gap-1 rounded-md border border-border/70 bg-background/95 px-1.5 text-[10px] font-medium text-muted-foreground opacity-0 shadow-xs outline-hidden transition-[opacity,transform,color,background-color,border-color] duration-200 ease-out hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-foreground focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-focus-within/thread-item:pointer-events-auto group-focus-within/thread-item:translate-x-0 group-focus-within/thread-item:opacity-100 group-hover/thread-item:pointer-events-auto group-hover/thread-item:translate-x-0 group-hover/thread-item:opacity-100 pointer-events-none"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void handleArchiveAction(thread).catch((error) => {
                            toastManager.add({
                              type: "error",
                              title: "Failed to archive thread",
                              description: error instanceof Error ? error.message : "An error occurred.",
                            });
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.stopPropagation();
                          }
                        }}
                      />
                    }
                  >
                    <ArchiveIcon className="size-3" />
                    <span>Archive</span>
                  </TooltipTrigger>
                  <TooltipPopup side="top">Archive thread</TooltipPopup>
                </Tooltip>
              </div>
            )}
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      );
    },
    [
      cancelRename,
      commitRename,
      handleThreadContextMenu,
      navigate,
      openPrLink,
      pendingApprovalByThreadId,
      prByThreadId,
      handleArchiveAction,
      renamingThreadId,
      renamingTitle,
      routeThreadId,
      terminalStateByThreadId,
    ],
  );

  const wordmark = (
    <button
      type="button"
      aria-label="Start a new thread"
      className="group relative flex w-full min-w-0 cursor-pointer justify-center rounded-xl py-1 outline-hidden transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
      onClick={handleTopLevelNewThread}
    >
      <div className="pointer-events-none absolute inset-x-10 top-0 h-8 rounded-full bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--color-primary)_14%,transparent)_0%,transparent_70%)] blur-2xl" />
      <div className="relative h-10 w-[184px] overflow-hidden">
        <img
          src={beppoSidebarLogo}
          alt="Beppo"
          className="absolute top-1/2 left-1/2 h-28 w-auto max-w-none shrink-0 -translate-x-1/2 -translate-y-1/2 object-cover"
        />
      </div>
    </button>
  );

  return (
    <>
      {isElectron ? (
        <SidebarHeader className="drag-region relative px-4 pt-3 pb-1">
          <SidebarTrigger className="absolute top-3 left-4 shrink-0 md:hidden" />
          <div className="relative flex min-h-10 items-center justify-center">{wordmark}</div>
          {showDesktopUpdateButton && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={desktopUpdateTooltip}
                    aria-disabled={desktopUpdateButtonDisabled || undefined}
                    disabled={desktopUpdateButtonDisabled}
                    className={`absolute top-3 right-4 inline-flex size-8 items-center justify-center rounded-full border border-border/70 bg-background/75 text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    <RocketIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
            </Tooltip>
          )}
        </SidebarHeader>
      ) : (
        <SidebarHeader className="relative px-4 pt-3 pb-1">
          <SidebarTrigger className="absolute top-3 left-4 shrink-0 md:hidden" />
          <div className="relative flex min-h-10 items-center justify-center">{wordmark}</div>
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        <SidebarGroup className="px-3 pt-1 pb-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="h-11 w-full justify-between rounded-2xl px-4 shadow-sm"
                  onClick={handleTopLevelNewThread}
                >
                  <span className="inline-flex items-center gap-2">
                    <SquarePenIcon data-icon="inline-start" />
                    New thread
                  </span>
                  {newThreadShortcutLabel ? (
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
                      {newThreadShortcutLabel}
                    </span>
                  ) : null}
                </Button>
              }
            />
            <TooltipPopup side="bottom">
              {newThreadShortcutLabel
                ? `New thread (${newThreadShortcutLabel})`
                : "Create a new thread"}
            </TooltipPopup>
          </Tooltip>

        </SidebarGroup>

        <SidebarGroup className="px-2 py-2">
          <SidebarMenu>
            {projects.map((project) => {
              const projectThreads = threads
                .filter((thread) => thread.projectId === project.id)
                .toSorted((a, b) => {
                  const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                  if (byDate !== 0) return byDate;
                  return b.id.localeCompare(a.id);
                });
              const activeThreads = projectThreads.filter((thread) => thread.archivedAt === null);
              const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
              const hasHiddenThreads = activeThreads.length > THREAD_PREVIEW_LIMIT;
              const visibleThreads =
                hasHiddenThreads && !isThreadListExpanded
                  ? activeThreads.slice(0, THREAD_PREVIEW_LIMIT)
                  : activeThreads;

              return (
                <Collapsible
                  key={project.id}
                  className="group/collapsible"
                  open={project.expanded}
                  onOpenChange={(open) => {
                    if (open === project.expanded) return;
                    toggleProject(project.id);
                  }}
                >
                  <SidebarMenuItem>
                    <div className="group/project-header relative">
                      <CollapsibleTrigger
                        render={
                          <SidebarMenuButton
                            size="sm"
                            className="gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground"
                          />
                        }
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void handleProjectContextMenu(project.id, {
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <ChevronRightIcon
                          className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                            project.expanded ? "rotate-90" : ""
                          }`}
                        />
                        <ProjectFavicon cwd={project.cwd} />
                        <span className="flex-1 truncate text-xs font-medium text-foreground/90">
                          {project.name}
                        </span>
                      </CollapsibleTrigger>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <SidebarMenuAction
                              render={
                                <button
                                  type="button"
                                  aria-label={`Create new thread in ${project.name}`}
                                />
                              }
                              showOnHover
                              className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void handleNewThread(project.id);
                              }}
                            >
                              <SquarePenIcon className="size-3.5" />
                            </SidebarMenuAction>
                          }
                        />
                        <TooltipPopup side="top">
                          {newThreadShortcutLabel
                            ? `New thread (${newThreadShortcutLabel})`
                            : "New thread"}
                        </TooltipPopup>
                      </Tooltip>
                    </div>

                    <CollapsibleContent>
                      <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0 px-1.5 py-0">
                        {visibleThreads.map((thread) => renderThreadItem(thread))}

                        {hasHiddenThreads && !isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                expandThreadListForProject(project.id);
                              }}
                            >
                              <span>Show more</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                        {hasHiddenThreads && isThreadListExpanded && (
                          <SidebarMenuSubItem className="w-full">
                            <SidebarMenuSubButton
                              render={<button type="button" />}
                              size="sm"
                              className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                              onClick={() => {
                                collapseThreadListForProject(project.id);
                              }}
                            >
                              <span>Show less</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        )}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>

          {projects.length === 0 && !addingProject && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet.
              <br />
              Add one to get started.
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <Dialog
        open={threadActionDialog !== null}
        onOpenChange={(open) => {
          if (open) {
            return;
          }
          closeThreadActionDialog();
        }}
      >
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete archived thread</DialogTitle>
            <DialogDescription>
              This permanently removes the archived conversation history.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {dialogThread ? (
              <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
                <p className="text-sm font-medium text-foreground">{dialogThread.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Deleting an archived thread cannot be undone.
                </p>
              </div>
            ) : null}
            {threadActionDialog?.canDeleteWorktree ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-background/70 p-4">
                <Checkbox
                  checked={deleteArchivedWorktree}
                  onCheckedChange={(checked) => setDeleteArchivedWorktree(Boolean(checked))}
                />
                <span className="space-y-1 text-sm">
                  <span className="block font-medium text-foreground">Delete linked worktree too</span>
                  <span className="block text-muted-foreground">
                    {threadActionDialog.displayWorktreePath ?? threadActionDialog.orphanedWorktreePath}
                  </span>
                </span>
              </label>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeThreadActionDialog}
              disabled={isThreadActionPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmThreadActionDialog()}
              disabled={!dialogThread || isThreadActionPending}
            >
              {isThreadActionPending ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <SidebarSeparator />
      <SidebarFooter className="gap-0 p-3">
        <div className="flex flex-col gap-0">
          {addingProject ? (
            <>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Add project
              </p>
              <Input
                className="mb-2 h-9 font-mono text-xs"
                placeholder="/path/to/project"
                value={newCwd}
                onChange={(event) => setNewCwd(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleAddProject();
                  if (event.key === "Escape") setAddingProject(false);
                }}
              />
              {isElectron ? (
                <Button
                  variant="outline"
                  className="mb-2 w-full justify-center"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </Button>
              ) : null}
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleAddProject} disabled={isAddingProject}>
                  {isAddingProject ? "Adding..." : "Add"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setAddingProject(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="outline"
              className="w-full justify-center border-dashed text-muted-foreground"
              onClick={() => setAddingProject(true)}
            >
              Add project
            </Button>
          )}
        </div>
        <SidebarSeparator className="my-3" />
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant={isArchiveRoute ? "secondary" : "outline"}
                  aria-label="Archived chats"
                />
              }
              onClick={() => {
                void navigate({ to: "/archive" });
              }}
            >
              <ArchiveIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Archived chats</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant={isSettingsRoute ? "secondary" : "outline"}
                  aria-label="Settings"
                />
              }
              onClick={() => {
                void navigate({ to: "/settings" });
              }}
            >
              <SettingsIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Settings</TooltipPopup>
          </Tooltip>
        </div>
      </SidebarFooter>
    </>
  );
}
