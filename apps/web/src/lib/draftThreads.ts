import { type ProjectId, type RuntimeMode, type ThreadId } from "@t3tools/contracts";

import { type DraftThreadEnvMode, type DraftThreadState } from "../composerDraftStore";
import { type Project, type Thread } from "../types";

type ProjectDraftThread = DraftThreadState & {
  threadId: ThreadId;
};

interface DraftThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  createdAt?: string;
  envMode?: DraftThreadEnvMode;
  runtimeMode?: RuntimeMode;
}

interface EnsureProjectDraftThreadParams {
  projectId: ProjectId;
  routeThreadId: ThreadId | null;
  getDraftThreadByProjectId: (projectId: ProjectId) => ProjectDraftThread | null;
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null;
  setDraftThreadContext: (
    threadId: ThreadId,
    options: {
      branch?: string | null;
      worktreePath?: string | null;
      projectId?: ProjectId;
      createdAt?: string;
      envMode?: DraftThreadEnvMode;
      runtimeMode?: RuntimeMode;
    },
  ) => void;
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: DraftThreadOptions,
  ) => void;
  clearProjectDraftThreadId: (projectId: ProjectId) => void;
  createThreadId: () => ThreadId;
  options?: DraftThreadOptions;
}

function syncDraftThreadContext(
  threadId: ThreadId,
  options: DraftThreadOptions | undefined,
  setDraftThreadContext: EnsureProjectDraftThreadParams["setDraftThreadContext"],
) {
  const hasBranchOption = options?.branch !== undefined;
  const hasWorktreePathOption = options?.worktreePath !== undefined;
  const hasEnvModeOption = options?.envMode !== undefined;
  const hasRuntimeModeOption = options?.runtimeMode !== undefined;

  if (!hasBranchOption && !hasWorktreePathOption && !hasEnvModeOption && !hasRuntimeModeOption) {
    return;
  }

  setDraftThreadContext(threadId, {
    ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
    ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
    ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
    ...(hasRuntimeModeOption ? { runtimeMode: options?.runtimeMode } : {}),
  });
}

export function ensureProjectDraftThread(params: EnsureProjectDraftThreadParams): ThreadId {
  const {
    projectId,
    routeThreadId,
    getDraftThreadByProjectId,
    getDraftThread,
    setDraftThreadContext,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
    createThreadId,
    options,
  } = params;

  const storedDraftThread = getDraftThreadByProjectId(projectId);
  if (storedDraftThread) {
    syncDraftThreadContext(storedDraftThread.threadId, options, setDraftThreadContext);
    setProjectDraftThreadId(projectId, storedDraftThread.threadId);
    return storedDraftThread.threadId;
  }

  clearProjectDraftThreadId(projectId);

  const activeDraftThread = routeThreadId ? getDraftThread(routeThreadId) : null;
  if (activeDraftThread && routeThreadId && activeDraftThread.projectId === projectId) {
    syncDraftThreadContext(routeThreadId, options, setDraftThreadContext);
    setProjectDraftThreadId(projectId, routeThreadId);
    return routeThreadId;
  }

  const threadId = createThreadId();
  setProjectDraftThreadId(projectId, threadId, options);
  return threadId;
}

export function preferredProjectIdForNewThread(input: {
  projects: Project[];
  threads: Thread[];
}): ProjectId | null {
  const { projects, threads } = input;
  const activeThreads = threads.filter((thread) => thread.archivedAt === null);
  const mostRecentlyActiveThread = activeThreads
    .filter((thread) => thread.latestTurn?.requestedAt)
    .toSorted((a, b) => {
      const byRequestedAt =
        Date.parse(b.latestTurn?.requestedAt ?? "") - Date.parse(a.latestTurn?.requestedAt ?? "");
      if (byRequestedAt !== 0 && !Number.isNaN(byRequestedAt)) {
        return byRequestedAt;
      }
      const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (byCreatedAt !== 0 && !Number.isNaN(byCreatedAt)) {
        return byCreatedAt;
      }
      return b.id.localeCompare(a.id);
    })[0];

  if (mostRecentlyActiveThread) {
    return mostRecentlyActiveThread.projectId;
  }

  const mostRecentlyCreatedThread = activeThreads.toSorted((a, b) => {
    const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byCreatedAt !== 0 && !Number.isNaN(byCreatedAt)) {
      return byCreatedAt;
    }
    return b.id.localeCompare(a.id);
  })[0];

  return mostRecentlyCreatedThread?.projectId ?? projects[0]?.id ?? null;
}
