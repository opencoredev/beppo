#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  CheckpointRef,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  type OrchestrationShellSnapshot,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";

import {
  applyOrchestrationEvents,
  type AppState,
  setActiveEnvironmentId,
  selectEnvironmentState,
  syncServerShellSnapshot,
  syncServerThreadDetail,
} from "../apps/web/src/store.ts";
import { useTerminalStateStore } from "../apps/web/src/terminalStateStore.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDistRoot = resolve(repoRoot, "apps/web/dist");
const webBundleBudgets = {
  entryJavaScriptBytes: 3_100_000,
  totalJavaScriptBytes: 14_500_000,
  totalCssBytes: 400_000,
} as const;
const snapshotBenchmarkFixture = {
  projectCount: 36,
  threadsPerProject: 10,
  messagesPerThread: 6,
  activitiesPerThread: 2,
  checkpointsPerThread: 2,
  maxDurationMs: 250,
} as const;
const replayBenchmarkFixture = {
  projectCount: 12,
  threadsPerProject: 8,
  eventsPerThread: 18,
  maxDurationMs: 350,
} as const;
const streamingBenchmarkFixture = {
  chunkCount: 2_048,
  chunkSize: 64,
  maxDurationMs: 250,
} as const;
const terminalBenchmarkFixture = {
  threadCount: 160,
  terminalsPerThread: 6,
  maxDurationMs: 525,
} as const;
const perfEnvironmentId = EnvironmentId.make("perf-environment");

type CheckName = "web-bundle" | "snapshot" | "replay" | "stream" | "terminal";

interface WebBundleStats {
  readonly entryJavaScriptBytes: number;
  readonly totalJavaScriptBytes: number;
  readonly totalCssBytes: number;
  readonly totalAssetBytes: number;
  readonly totalFiles: number;
  readonly entryJavaScriptFile: string;
  readonly entryCssFile: string;
}

interface FixtureRunResult {
  readonly durationMs: number;
  readonly summary: string;
}

function createEmptyAppState(): AppState {
  return {
    activeEnvironmentId: null,
    environmentStateById: {},
  };
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = units[0];
  for (const nextUnit of units.slice(1)) {
    if (value < 1024) {
      break;
    }
    value /= 1024;
    unit = nextUnit;
  }
  return `${value.toFixed(value >= 100 || unit === "B" ? 0 : 2)} ${unit}`;
}

function formatDuration(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatRate(count: number, durationMs: number): string {
  if (durationMs <= 0) {
    return "n/a";
  }
  return `${Math.round((count / durationMs) * 1000).toLocaleString("en-US")} ops/s`;
}

function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

function buildIsoTime(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 1, 27, 0, 0, offsetSeconds)).toISOString();
}

function makePerfThreadRef(threadId: ThreadId): {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
} {
  return {
    environmentId: perfEnvironmentId,
    threadId,
  };
}

function makePerfThreadKey(threadId: ThreadId): string {
  return `${perfEnvironmentId}:${threadId}`;
}

function buildShellSnapshotFixture(readModel: OrchestrationReadModel): OrchestrationShellSnapshot {
  return {
    snapshotSequence: readModel.snapshotSequence,
    projects: readModel.projects.map((project) => ({
      id: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryIdentity: project.repositoryIdentity ?? null,
      defaultModelSelection: project.defaultModelSelection,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    threads: readModel.threads.map((thread) => ({
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      latestTurn: thread.latestTurn,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      session: thread.session,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    })),
    updatedAt: readModel.updatedAt,
  };
}

function seedAppStateFromReadModel(readModel: OrchestrationReadModel): AppState {
  const shellSnapshot = buildShellSnapshotFixture(readModel);
  let state = setActiveEnvironmentId(createEmptyAppState(), perfEnvironmentId);
  state = syncServerShellSnapshot(state, shellSnapshot, perfEnvironmentId);
  for (const thread of readModel.threads) {
    state = syncServerThreadDetail(state, thread, perfEnvironmentId);
  }
  return state;
}

function makeBaseEvent<T extends OrchestrationEvent["type"]>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>["payload"],
  sequence: number,
  aggregateId: ProjectId | ThreadId,
): Extract<OrchestrationEvent, { type: T }> {
  return {
    sequence,
    eventId: EventId.make(`perf-event-${sequence}`),
    aggregateKind: "thread",
    aggregateId,
    occurredAt: buildIsoTime(sequence),
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  } as Extract<OrchestrationEvent, { type: T }>;
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function countFiles(rootDir: string): number {
  let total = 0;
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        total += 1;
      }
    }
  }
  return total;
}

function buildMessagePair(
  projectIndex: number,
  threadIndex: number,
  pairIndex: number,
): {
  readonly userMessage: OrchestrationReadModel["threads"][number]["messages"][number];
  readonly assistantMessage: OrchestrationReadModel["threads"][number]["messages"][number];
  readonly turnId: TurnId;
} {
  const turnId = TurnId.make(`turn-${projectIndex}-${threadIndex}-${pairIndex}`);
  const userMessageId = MessageId.make(`message-${projectIndex}-${threadIndex}-${pairIndex}-user`);
  const assistantMessageId = MessageId.make(
    `message-${projectIndex}-${threadIndex}-${pairIndex}-assistant`,
  );
  const baseOffset = projectIndex * 1_000 + threadIndex * 10 + pairIndex * 2;

  return {
    turnId,
    userMessage: {
      id: userMessageId,
      role: "user",
      text: `User prompt ${projectIndex}:${threadIndex}:${pairIndex}`,
      turnId,
      streaming: false,
      createdAt: buildIsoTime(baseOffset),
      updatedAt: buildIsoTime(baseOffset),
    },
    assistantMessage: {
      id: assistantMessageId,
      role: "assistant",
      text: `Assistant reply ${projectIndex}:${threadIndex}:${pairIndex}`,
      turnId,
      streaming: false,
      createdAt: buildIsoTime(baseOffset + 1),
      updatedAt: buildIsoTime(baseOffset + 1),
    },
  };
}

export function buildSnapshotReadModelFixture(
  options: {
    readonly projectCount?: number;
    readonly threadsPerProject?: number;
    readonly messagesPerThread?: number;
    readonly activitiesPerThread?: number;
    readonly checkpointsPerThread?: number;
  } = {},
): OrchestrationReadModel {
  const projectCount = options.projectCount ?? snapshotBenchmarkFixture.projectCount;
  const threadsPerProject = options.threadsPerProject ?? snapshotBenchmarkFixture.threadsPerProject;
  const messagesPerThread = options.messagesPerThread ?? snapshotBenchmarkFixture.messagesPerThread;
  const activitiesPerThread =
    options.activitiesPerThread ?? snapshotBenchmarkFixture.activitiesPerThread;
  const checkpointsPerThread =
    options.checkpointsPerThread ?? snapshotBenchmarkFixture.checkpointsPerThread;

  const projects: Array<OrchestrationReadModel["projects"][number]> = [];
  const threads: Array<OrchestrationReadModel["threads"][number]> = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectId = ProjectId.make(`project-${projectIndex}`);
    projects.push({
      id: projectId,
      title: `Project ${projectIndex + 1}`,
      workspaceRoot: `/tmp/project-${projectIndex + 1}`,
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: buildIsoTime(projectIndex * 1_000),
      updatedAt: buildIsoTime(projectIndex * 1_000 + 1),
      deletedAt: null,
      scripts: [],
    });

    for (let threadIndex = 0; threadIndex < threadsPerProject; threadIndex += 1) {
      const threadId = ThreadId.make(`thread-${projectIndex}-${threadIndex}`);
      const messagePairs = Math.max(1, Math.ceil(messagesPerThread / 2));
      const messages: Array<OrchestrationReadModel["threads"][number]["messages"][number]> = [];
      let latestAssistantMessageId: MessageId | null = null;
      let latestTurnId: TurnId | null = null;

      for (let pairIndex = 0; pairIndex < messagePairs; pairIndex += 1) {
        const pair = buildMessagePair(projectIndex, threadIndex, pairIndex);
        messages.push(pair.userMessage);
        if (messages.length < messagesPerThread) {
          messages.push(pair.assistantMessage);
          latestAssistantMessageId = pair.assistantMessage.id;
          latestTurnId = pair.turnId;
        }
      }

      const checkpoints = Array.from({ length: checkpointsPerThread }, (_, checkpointIndex) => ({
        turnId: TurnId.make(`checkpoint-turn-${projectIndex}-${threadIndex}-${checkpointIndex}`),
        checkpointTurnCount: checkpointIndex + 1,
        checkpointRef: CheckpointRef.make(
          `refs/t3/checkpoints/project-${projectIndex}/thread-${threadIndex}/${checkpointIndex + 1}`,
        ),
        status: "ready" as const,
        files: [],
        assistantMessageId: latestAssistantMessageId,
        completedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 100 + checkpointIndex),
      }));

      const activities = Array.from({ length: activitiesPerThread }, (_, activityIndex) => ({
        id: EventId.make(`activity-${projectIndex}-${threadIndex}-${activityIndex}`),
        tone: "info" as const,
        kind: "perf.activity",
        summary: `Activity ${activityIndex + 1}`,
        payload: {
          activityIndex,
          projectIndex,
          threadIndex,
        },
        turnId: latestTurnId,
        sequence: activityIndex + 1,
        createdAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 200 + activityIndex),
      }));

      threads.push({
        id: threadId,
        projectId,
        title: `Thread ${projectIndex + 1}.${threadIndex + 1}`,
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn:
          latestTurnId === null || latestAssistantMessageId === null
            ? null
            : {
                turnId: latestTurnId,
                state: "completed",
                requestedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 2),
                startedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 3),
                completedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 4),
                assistantMessageId: latestAssistantMessageId,
              },
        createdAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10),
        updatedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 5),
        archivedAt: null,
        deletedAt: null,
        messages,
        proposedPlans: [],
        activities,
        checkpoints,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: buildIsoTime(projectIndex * 1_000 + threadIndex * 10 + 5),
        },
      });
    }
  }

  return {
    snapshotSequence: 1,
    projects,
    threads,
    updatedAt: buildIsoTime(0),
  };
}

export function readWebBundleStats(distRoot: string = webDistRoot): WebBundleStats {
  const indexHtmlPath = resolve(distRoot, "index.html");
  if (!existsSync(indexHtmlPath)) {
    throw new Error(
      `Missing web bundle at ${indexHtmlPath}. Run 'bun run build' or 'bun run perf' first.`,
    );
  }

  const indexHtml = readFileSync(indexHtmlPath, "utf8");
  const scriptMatch = indexHtml.match(/<script\b[^>]*src="([^"]+\.js)"/);
  const styleMatch = indexHtml.match(/<link\b[^>]*href="([^"]+\.css)"/);
  if (!scriptMatch || !styleMatch) {
    throw new Error(`Unable to find the web entry assets in ${indexHtmlPath}.`);
  }

  const entryJavaScriptFile = scriptMatch[1]!.replace(/^\.\//, "");
  const entryCssFile = styleMatch[1]!.replace(/^\.\//, "");
  const entryJavaScriptPath = resolve(distRoot, entryJavaScriptFile);
  let totalJavaScriptBytes = 0;
  let totalCssBytes = 0;
  let totalAssetBytes = 0;

  const stack = [distRoot];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const size = statSync(entryPath).size;
      totalAssetBytes += size;
      if (entryPath.endsWith(".js") && !entryPath.endsWith(".map")) {
        totalJavaScriptBytes += size;
      }
      if (entryPath.endsWith(".css")) {
        totalCssBytes += size;
      }
    }
  }

  return {
    entryJavaScriptBytes: statSync(entryJavaScriptPath).size,
    totalJavaScriptBytes,
    totalCssBytes,
    totalAssetBytes,
    totalFiles: countFiles(distRoot),
    entryJavaScriptFile: entryJavaScriptFile,
    entryCssFile,
  };
}

export function buildReplayFixture(
  options: {
    readonly projectCount?: number;
    readonly threadsPerProject?: number;
    readonly eventsPerThread?: number;
  } = {},
): {
  readonly initialState: AppState;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly threadCount: number;
  readonly eventCount: number;
} {
  const projectCount = options.projectCount ?? replayBenchmarkFixture.projectCount;
  const threadsPerProject = options.threadsPerProject ?? replayBenchmarkFixture.threadsPerProject;
  const eventsPerThread = options.eventsPerThread ?? replayBenchmarkFixture.eventsPerThread;
  const snapshot = buildSnapshotReadModelFixture({
    projectCount,
    threadsPerProject,
    messagesPerThread: 2,
    activitiesPerThread: 1,
    checkpointsPerThread: 1,
  });
  const initialState = seedAppStateFromReadModel(snapshot);
  const events: OrchestrationEvent[] = [];
  let sequence = 1;

  for (const thread of snapshot.threads) {
    for (let eventIndex = 0; eventIndex < eventsPerThread; eventIndex += 1) {
      const isAssistant = eventIndex % 2 === 1;
      const messageId = MessageId.make(`replay-message-${thread.id}-${eventIndex}`);
      const turnId = isAssistant
        ? TurnId.make(`replay-turn-${thread.id}-${Math.floor(eventIndex / 2)}`)
        : null;

      events.push(
        makeBaseEvent(
          "thread.message-sent",
          {
            threadId: thread.id,
            messageId,
            role: isAssistant ? "assistant" : "user",
            text: isAssistant
              ? `Assistant stream ${thread.id} ${eventIndex}`
              : `User message ${thread.id} ${eventIndex}`,
            turnId,
            streaming: false,
            createdAt: buildIsoTime(sequence),
            updatedAt: buildIsoTime(sequence),
          },
          sequence,
          thread.id,
        ),
      );
      sequence += 1;
    }
  }

  return {
    initialState,
    events,
    threadCount: snapshot.threads.length,
    eventCount: events.length,
  };
}

export function buildStreamingTurnFixture(
  options: {
    readonly chunkCount?: number;
    readonly chunkSize?: number;
  } = {},
): {
  readonly initialState: AppState;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly chunkCount: number;
  readonly expectedTextLength: number;
} {
  const chunkCount = options.chunkCount ?? streamingBenchmarkFixture.chunkCount;
  const chunkSize = options.chunkSize ?? streamingBenchmarkFixture.chunkSize;
  const snapshot = buildSnapshotReadModelFixture({
    projectCount: 1,
    threadsPerProject: 1,
    messagesPerThread: 1,
    activitiesPerThread: 0,
    checkpointsPerThread: 0,
  });
  const thread = snapshot.threads[0];
  if (!thread) {
    throw new Error("Streaming fixture failed to create a thread.");
  }

  const initialState = seedAppStateFromReadModel(snapshot);
  const turnId = TurnId.make(`stream-turn-${thread.id}`);
  const assistantMessageId = MessageId.make(`stream-message-${thread.id}`);
  const chunk = "x".repeat(chunkSize);
  const events: OrchestrationEvent[] = [
    makeBaseEvent(
      "thread.message-sent",
      {
        threadId: thread.id,
        messageId: MessageId.make(`stream-user-${thread.id}`),
        role: "user",
        text: "Give me a long streamed answer.",
        turnId: null,
        streaming: false,
        createdAt: buildIsoTime(1),
        updatedAt: buildIsoTime(1),
      },
      1,
      thread.id,
    ),
    makeBaseEvent(
      "thread.session-set",
      {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: turnId,
          lastError: null,
          updatedAt: buildIsoTime(2),
        },
      },
      2,
      thread.id,
    ),
  ];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    events.push(
      makeBaseEvent(
        "thread.message-sent",
        {
          threadId: thread.id,
          messageId: assistantMessageId,
          role: "assistant",
          text: chunk,
          turnId,
          streaming: true,
          createdAt: buildIsoTime(3 + chunkIndex),
          updatedAt: buildIsoTime(3 + chunkIndex),
        },
        3 + chunkIndex,
        thread.id,
      ),
    );
  }

  events.push(
    makeBaseEvent(
      "thread.message-sent",
      {
        threadId: thread.id,
        messageId: assistantMessageId,
        role: "assistant",
        text: "",
        turnId,
        streaming: false,
        createdAt: buildIsoTime(3 + chunkCount),
        updatedAt: buildIsoTime(3 + chunkCount),
      },
      3 + chunkCount,
      thread.id,
    ),
  );

  return {
    initialState,
    events,
    chunkCount,
    expectedTextLength: chunk.length * chunkCount,
  };
}

function runWebBundleCheck(): FixtureRunResult {
  const stats = readWebBundleStats();
  assertCondition(
    stats.entryJavaScriptBytes <= webBundleBudgets.entryJavaScriptBytes,
    `Web entry bundle is too large: ${formatBytes(stats.entryJavaScriptBytes)} (budget ${formatBytes(webBundleBudgets.entryJavaScriptBytes)}).`,
  );
  assertCondition(
    stats.totalJavaScriptBytes <= webBundleBudgets.totalJavaScriptBytes,
    `Web JavaScript bundle is too large: ${formatBytes(stats.totalJavaScriptBytes)} (budget ${formatBytes(webBundleBudgets.totalJavaScriptBytes)}).`,
  );
  assertCondition(
    stats.totalCssBytes <= webBundleBudgets.totalCssBytes,
    `Web CSS bundle is too large: ${formatBytes(stats.totalCssBytes)} (budget ${formatBytes(webBundleBudgets.totalCssBytes)}).`,
  );

  return {
    durationMs: 0,
    summary: `entry ${formatBytes(stats.entryJavaScriptBytes)} from ${stats.entryJavaScriptFile}, total JS ${formatBytes(stats.totalJavaScriptBytes)}, CSS ${formatBytes(stats.totalCssBytes)}, assets ${formatBytes(stats.totalAssetBytes)} across ${formatCount(stats.totalFiles)} files`,
  };
}

function runSnapshotBootstrapCheck(): FixtureRunResult {
  const readModel = buildSnapshotReadModelFixture(snapshotBenchmarkFixture);
  const startedAt = performance.now();
  const nextState = seedAppStateFromReadModel(readModel);
  const durationMs = performance.now() - startedAt;

  const environmentState = selectEnvironmentState(nextState, perfEnvironmentId);
  assertCondition(
    nextState.activeEnvironmentId === perfEnvironmentId,
    "Snapshot bootstrap did not set the active environment.",
  );
  assertCondition(environmentState.bootstrapComplete, "Snapshot bootstrap did not complete.");
  assertCondition(
    environmentState.projectIds.length === readModel.projects.length,
    `Snapshot bootstrap projected ${environmentState.projectIds.length} projects, expected ${readModel.projects.length}.`,
  );
  assertCondition(
    environmentState.threadIds.length === readModel.threads.length,
    `Snapshot bootstrap projected ${environmentState.threadIds.length} threads, expected ${readModel.threads.length}.`,
  );
  assertCondition(
    durationMs <= snapshotBenchmarkFixture.maxDurationMs,
    `Snapshot bootstrap took ${formatDuration(durationMs)} (budget ${formatDuration(snapshotBenchmarkFixture.maxDurationMs)}).`,
  );

  return {
    durationMs,
    summary: `${formatCount(environmentState.projectIds.length)} projects, ${formatCount(environmentState.threadIds.length)} threads`,
  };
}

function runReplayThroughputCheck(): FixtureRunResult {
  const fixture = buildReplayFixture(replayBenchmarkFixture);
  const startedAt = performance.now();
  const nextState = applyOrchestrationEvents(
    fixture.initialState,
    fixture.events,
    perfEnvironmentId,
  );
  const durationMs = performance.now() - startedAt;
  const environmentState = selectEnvironmentState(nextState, perfEnvironmentId);

  assertCondition(
    environmentState.threadIds.length === fixture.threadCount,
    `Replay changed the thread count from ${fixture.threadCount} to ${environmentState.threadIds.length}.`,
  );
  assertCondition(
    durationMs <= replayBenchmarkFixture.maxDurationMs,
    `Replay batch took ${formatDuration(durationMs)} (budget ${formatDuration(replayBenchmarkFixture.maxDurationMs)}).`,
  );

  return {
    durationMs,
    summary: `${formatCount(fixture.eventCount)} events across ${formatCount(fixture.threadCount)} threads in ${formatDuration(durationMs)} (${formatRate(fixture.eventCount, durationMs)})`,
  };
}

function runStreamingTurnCheck(): FixtureRunResult {
  const fixture = buildStreamingTurnFixture(streamingBenchmarkFixture);
  const startedAt = performance.now();
  const nextState = applyOrchestrationEvents(
    fixture.initialState,
    fixture.events,
    perfEnvironmentId,
  );
  const durationMs = performance.now() - startedAt;
  const environmentState = selectEnvironmentState(nextState, perfEnvironmentId);
  const threadId = environmentState.threadIds[0];
  const messages = threadId
    ? (environmentState.messageIdsByThreadId[threadId] ?? []).flatMap((messageId) => {
        const message = environmentState.messageByThreadId[threadId]?.[messageId];
        return message ? [message] : [];
      })
    : [];
  const assistantMessage = messages.find((message) => message.id.includes("stream-message"));

  assertCondition(threadId !== undefined, "Streaming fixture did not preserve the thread.");
  assertCondition(
    assistantMessage !== undefined,
    "Streaming fixture did not produce the assistant message.",
  );
  assertCondition(
    assistantMessage?.streaming === false,
    "Streaming fixture assistant message never completed.",
  );
  assertCondition(
    assistantMessage?.text.length === fixture.expectedTextLength,
    `Streaming fixture produced ${assistantMessage?.text.length ?? 0} chars, expected ${fixture.expectedTextLength}.`,
  );
  assertCondition(
    durationMs <= streamingBenchmarkFixture.maxDurationMs,
    `Streaming turn took ${formatDuration(durationMs)} (budget ${formatDuration(streamingBenchmarkFixture.maxDurationMs)}).`,
  );

  return {
    durationMs,
    summary: `${formatCount(fixture.chunkCount)} streamed chunks, ${formatBytes(fixture.expectedTextLength)} of text`,
  };
}

function runTerminalScaleCheck(): FixtureRunResult {
  useTerminalStateStore.persist.clearStorage();
  useTerminalStateStore.setState({
    terminalStateByThreadKey: {},
    terminalLaunchContextByThreadKey: {},
    terminalEventEntriesByKey: {},
    nextTerminalEventId: 0,
  });

  const store = useTerminalStateStore.getState();
  const threadIds = Array.from({ length: terminalBenchmarkFixture.threadCount }, (_, index) =>
    ThreadId.make(`terminal-thread-${index}`),
  );
  const totalTerminals =
    terminalBenchmarkFixture.threadCount * terminalBenchmarkFixture.terminalsPerThread;
  const threadRefs = threadIds.map(makePerfThreadRef);
  const keptThreadKeys = new Set(
    threadIds.filter((_, index) => index % 2 === 0).map((threadId) => makePerfThreadKey(threadId)),
  );

  const startedAt = performance.now();
  for (let threadIndex = 0; threadIndex < threadRefs.length; threadIndex += 1) {
    const threadRef = threadRefs[threadIndex];
    if (!threadRef) {
      continue;
    }

    store.setTerminalOpen(threadRef, true);
    store.setTerminalHeight(threadRef, 280 + (threadIndex % 3) * 10);

    for (
      let terminalIndex = 1;
      terminalIndex < terminalBenchmarkFixture.terminalsPerThread;
      terminalIndex += 1
    ) {
      const terminalId = `terminal-${threadIndex}-${terminalIndex}`;
      if (terminalIndex % 2 === 0) {
        store.splitTerminal(threadRef, terminalId);
      } else {
        store.newTerminal(threadRef, terminalId);
      }
      store.setTerminalActivity(threadRef, terminalId, terminalIndex % 3 === 0);
    }

    if (threadIndex % 5 === 0) {
      store.closeTerminal(
        threadRef,
        `terminal-${threadIndex}-${terminalBenchmarkFixture.terminalsPerThread - 1}`,
      );
    }
  }
  store.removeOrphanedTerminalStates(keptThreadKeys);
  const durationMs = performance.now() - startedAt;

  const terminalStateCount = Object.keys(
    useTerminalStateStore.getState().terminalStateByThreadKey,
  ).length;
  assertCondition(
    terminalStateCount === keptThreadKeys.size,
    `Terminal scale fixture kept ${terminalStateCount} thread states, expected ${keptThreadKeys.size}.`,
  );
  assertCondition(
    durationMs <= terminalBenchmarkFixture.maxDurationMs,
    `Terminal scale fixture took ${formatDuration(durationMs)} (budget ${formatDuration(terminalBenchmarkFixture.maxDurationMs)}).`,
  );

  useTerminalStateStore.persist.clearStorage();
  useTerminalStateStore.setState({
    terminalStateByThreadKey: {},
    terminalLaunchContextByThreadKey: {},
    terminalEventEntriesByKey: {},
    nextTerminalEventId: 0,
  });

  return {
    durationMs,
    summary: `${formatCount(threadIds.length)} threads, ${formatCount(totalTerminals)} terminal slots`,
  };
}

function parseChecks(argv: ReadonlyArray<string>): ReadonlyArray<CheckName> {
  const positionalArgs = argv.filter((arg) => !arg.startsWith("-"));
  if (positionalArgs.length === 0 || positionalArgs.includes("all")) {
    return ["web-bundle", "snapshot", "replay", "stream", "terminal"];
  }

  const validChecks: CheckName[] = [];
  for (const check of positionalArgs) {
    if (
      check !== "web-bundle" &&
      check !== "snapshot" &&
      check !== "replay" &&
      check !== "stream" &&
      check !== "terminal"
    ) {
      throw new Error(
        `Unknown perf check '${check}'. Expected one of: web-bundle, snapshot, replay, stream, terminal, all.`,
      );
    }
    validChecks.push(check);
  }
  return [...new Set(validChecks)];
}

function runSelectedChecks(checks: ReadonlyArray<CheckName>): void {
  for (const check of checks) {
    switch (check) {
      case "web-bundle": {
        const result = runWebBundleCheck();
        console.log(`[perf] web bundle: ${result.summary}`);
        break;
      }
      case "snapshot": {
        const result = runSnapshotBootstrapCheck();
        console.log(
          `[perf] snapshot bootstrap: ${result.summary} in ${formatDuration(result.durationMs)}`,
        );
        break;
      }
      case "replay": {
        const result = runReplayThroughputCheck();
        console.log(`[perf] replay throughput: ${result.summary}`);
        break;
      }
      case "stream": {
        const result = runStreamingTurnCheck();
        console.log(
          `[perf] streamed assistant turn: ${result.summary} in ${formatDuration(result.durationMs)}`,
        );
        break;
      }
      case "terminal": {
        const result = runTerminalScaleCheck();
        console.log(
          `[perf] terminal scale: ${result.summary} in ${formatDuration(result.durationMs)}`,
        );
        break;
      }
    }
  }
  console.log("[perf] guardrails passed.");
}

function main(): void {
  const checks = parseChecks(process.argv.slice(2));
  runSelectedChecks(checks);
}

const isDirectExecution =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(
      `[perf] ${error instanceof Error ? error.message : "Perf guardrail check failed."}`,
    );
    process.exit(1);
  }
}

export {
  createEmptyAppState,
  formatBytes,
  formatDuration,
  formatRate,
  parseChecks,
  runReplayThroughputCheck,
  runSelectedChecks,
  runSnapshotBootstrapCheck,
  runStreamingTurnCheck,
  runTerminalScaleCheck,
  runWebBundleCheck,
};
