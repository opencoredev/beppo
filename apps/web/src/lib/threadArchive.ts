import type { NativeApi, ThreadId } from "@t3tools/contracts";
import { ARCHIVED_THREAD_RETENTION_MS } from "@t3tools/shared/archive";

import { type Thread } from "../types";
import { newCommandId } from "./utils";

export function archiveDeleteAtIso(archivedAt: string): string {
  return new Date(Date.parse(archivedAt) + ARCHIVED_THREAD_RETENTION_MS).toISOString();
}

export function formatCalendarDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export async function archiveThreadCommand(
  api: NativeApi,
  thread: Pick<Thread, "id" | "session">,
): Promise<void> {
  if (thread.session && thread.session.status !== "closed") {
    await api.orchestration
      .dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: thread.id,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId: thread.id,
    archivedAt: new Date().toISOString(),
  });
}

export async function restoreThreadCommand(api: NativeApi, threadId: ThreadId): Promise<void> {
  await api.orchestration.dispatchCommand({
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId,
    archivedAt: null,
  });
}

export async function deleteThreadCommand(
  api: NativeApi,
  thread: Pick<Thread, "id" | "session">,
): Promise<void> {
  if (thread.session && thread.session.status !== "closed") {
    await api.orchestration
      .dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: thread.id,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

  try {
    await api.terminal.close({
      threadId: thread.id,
      deleteHistory: true,
    });
  } catch {
    // Terminal may already be closed or unavailable for archived threads.
  }

  await api.orchestration.dispatchCommand({
    type: "thread.delete",
    commandId: newCommandId(),
    threadId: thread.id,
  });
}
