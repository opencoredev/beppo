import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  EnvironmentId,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  hydrateThreadSnapshot,
  selectEnvironmentState,
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectThreadExistsByRef,
  selectThreadsAcrossEnvironments,
  setThreadBranch,
  syncServerReadModelSummary,
  type AppState,
  type EnvironmentState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    codexThreadId: null,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeEnvironmentState(
  thread: Thread,
  overrides: Partial<EnvironmentState> = {},
): EnvironmentState {
  const projectId = thread.projectId;
  const environmentState: EnvironmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: {
        id: projectId,
        environmentId: thread.environmentId,
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
        scripts: [],
      },
    },
    threadIds: [thread.id],
    threadIdsByProjectId: {
      [thread.projectId]: [thread.id],
    },
    threadShellById: {
      [thread.id]: {
        id: thread.id,
        environmentId: thread.environmentId,
        codexThreadId: thread.codexThreadId,
        projectId: thread.projectId,
        title: thread.title,
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        error: thread.error,
        createdAt: thread.createdAt,
        archivedAt: thread.archivedAt,
        updatedAt: thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    },
    threadSessionById: {
      [thread.id]: thread.session,
    },
    threadTurnStateById: {
      [thread.id]: {
        latestTurn: thread.latestTurn,
        ...(thread.pendingSourceProposedPlan
          ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
          : {}),
      },
    },
    messageIdsByThreadId: {
      [thread.id]: thread.messages.map((message) => message.id),
    },
    messageByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.messages.map((message) => [message.id, message] as const),
      ) as EnvironmentState["messageByThreadId"][ThreadId],
    },
    activityIdsByThreadId: {
      [thread.id]: thread.activities.map((activity) => activity.id),
    },
    activityByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.activities.map((activity) => [activity.id, activity] as const),
      ) as EnvironmentState["activityByThreadId"][ThreadId],
    },
    proposedPlanIdsByThreadId: {
      [thread.id]: thread.proposedPlans.map((plan) => plan.id),
    },
    proposedPlanByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.proposedPlans.map((plan) => [plan.id, plan] as const),
      ) as EnvironmentState["proposedPlanByThreadId"][ThreadId],
    },
    turnDiffIdsByThreadId: {
      [thread.id]: thread.turnDiffSummaries.map((summary) => summary.turnId),
    },
    turnDiffSummaryByThreadId: {
      [thread.id]: Object.fromEntries(
        thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
      ) as EnvironmentState["turnDiffSummaryByThreadId"][ThreadId],
    },
    sidebarThreadSummaryById: {},
    hydratedThreadIds: {},
    bootstrapComplete: true,
    ...overrides,
  };

  return environmentState;
}

function makeState(
  environments: Record<string, EnvironmentState>,
  activeEnvironmentId: EnvironmentId | null = localEnvironmentId,
): AppState {
  return {
    activeEnvironmentId,
    environmentStateById: environments,
  };
}

function makeEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
): Extract<OrchestrationEvent, { type: T }> {
  return {
    sequence: 1,
    eventId: EventId.makeUnsafe("event-1"),
    aggregateKind: "thread",
    aggregateId:
      "threadId" in payload
        ? payload.threadId
        : "projectId" in payload
          ? payload.projectId
          : ProjectId.make("project-1"),
    occurredAt: "2026-02-27T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as Extract<OrchestrationEvent, { type: T }>;
}

describe("store", () => {
  it("selects environment-scoped state and aggregates across environments", () => {
    const localThread = makeThread();
    const remoteThread = makeThread({
      id: ThreadId.make("thread-2"),
      environmentId: remoteEnvironmentId,
      projectId: ProjectId.make("project-2"),
    });
    const state = makeState(
      {
        [localEnvironmentId]: makeEnvironmentState(localThread),
        [remoteEnvironmentId]: makeEnvironmentState(remoteThread),
      },
      localEnvironmentId,
    );

    expect(selectEnvironmentState(state, localEnvironmentId).threadIds).toEqual([localThread.id]);
    expect(selectThreadsAcrossEnvironments(state).map((thread) => thread.id)).toEqual([
      localThread.id,
      remoteThread.id,
    ]);
    expect(selectProjectsAcrossEnvironments(state).map((project) => project.id)).toEqual([
      localThread.projectId,
      remoteThread.projectId,
    ]);
  });

  it("updates thread branch state without disturbing the rest of the environment", () => {
    const thread = makeThread({
      session: {
        provider: "codex",
        status: "running",
        orchestrationStatus: "running",
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
        activeTurnId: TurnId.makeUnsafe("turn-1"),
      },
    });
    const state = makeState({ [localEnvironmentId]: makeEnvironmentState(thread) });
    const threadRef = scopeThreadRef(localEnvironmentId, thread.id);

    const next = setThreadBranch(state, threadRef, "feature", "/tmp/project/.worktrees/feature");

    expect(selectThreadByRef(next, threadRef)?.branch).toBe("feature");
    expect(selectThreadByRef(next, threadRef)?.worktreePath).toBe(
      "/tmp/project/.worktrees/feature",
    );
    expect(selectThreadByRef(next, threadRef)?.session).toBeNull();
  });

  it("hydrates thread snapshots into the active environment", () => {
    const thread = makeThread();
    const state = makeState({ [localEnvironmentId]: makeEnvironmentState(thread) });
    const snapshot = {
      id: thread.id,
      projectId: thread.projectId,
      title: "Hydrated",
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: "main",
      worktreePath: "/tmp/project",
      latestTurn: null,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    } as unknown as OrchestrationReadModel["threads"][number];

    const next = hydrateThreadSnapshot(state, snapshot);
    const threadRef = scopeThreadRef(localEnvironmentId, thread.id);

    expect(selectThreadExistsByRef(next, threadRef)).toBe(true);
    expect(selectThreadByRef(next, threadRef)?.title).toBe("Hydrated");
    expect(next.environmentStateById[localEnvironmentId]?.hydratedThreadIds[thread.id]).toBe(true);
  });

  it("syncs read-model summaries for the active environment", () => {
    const thread = makeThread();
    const state = makeState({ [localEnvironmentId]: makeEnvironmentState(thread) });
    const readModel = {
      projects: [
        {
          id: thread.projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          repositoryIdentity: null,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          scripts: [],
          createdAt: "2026-02-13T00:00:00.000Z",
          updatedAt: "2026-02-13T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      threads: [
        {
          id: thread.id,
          projectId: thread.projectId,
          title: "Summary",
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          branch: "main",
          worktreePath: "/tmp/project",
          latestTurn: null,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
      ],
    } as unknown as OrchestrationReadModel;

    const next = syncServerReadModelSummary(state, readModel);

    expect(next.environmentStateById[localEnvironmentId]?.bootstrapComplete).toBe(true);
    expect(selectThreadByRef(next, scopeThreadRef(localEnvironmentId, thread.id))?.title).toBe(
      "Summary",
    );
  });

  it("applies orchestration events per environment and removes deleted threads", () => {
    const thread = makeThread();
    const state = makeState({ [localEnvironmentId]: makeEnvironmentState(thread) });
    const deleted = makeEvent("thread.deleted", { threadId: thread.id });

    const next = applyOrchestrationEvent(state, deleted, localEnvironmentId);

    expect(selectThreadExistsByRef(next, scopeThreadRef(localEnvironmentId, thread.id))).toBe(
      false,
    );
    expect(
      applyOrchestrationEvents(next, [deleted], localEnvironmentId).environmentStateById[
        localEnvironmentId
      ]?.threadIds,
    ).toEqual([]);
  });
});
