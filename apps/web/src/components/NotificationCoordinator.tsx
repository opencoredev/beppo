import { useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { toastManager } from "./ui/toast";
import { useNotificationStore } from "~/notifications/notificationStore";
import { formatNotificationBody, shouldNotify } from "~/notifications/notificationStore.logic";
import { useStore } from "~/store";
import { useUiStateStore } from "~/uiStateStore";

function parseThreadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:canvas\/|timeline\/)?([^/]+)$/);
  return match?.[1] ?? null;
}

export function NotificationCoordinator() {
  const threads = useStore((state) => state.threads);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const { enabled, permission, updateLastActivity } = useNotificationStore();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const currentThreadId = useMemo(() => parseThreadIdFromPath(pathname), [pathname]);
  const seenActivityIdsRef = useRef(new Set<string>());
  const seenCompletedTurnsRef = useRef(new Set<string>());
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (!bootstrappedRef.current) {
      for (const thread of threads) {
        const latestActivity = thread.activities.at(-1);
        if (latestActivity) {
          updateLastActivity(thread.id, latestActivity.createdAt);
        }
        for (const activity of thread.activities) {
          seenActivityIdsRef.current.add(activity.id);
        }
        const completedAt = thread.latestTurn?.completedAt ?? null;
        if (completedAt) {
          seenCompletedTurnsRef.current.add(
            `${thread.id}:${thread.latestTurn?.turnId ?? completedAt}`,
          );
        }
      }
      bootstrappedRef.current = true;
      return;
    }

    const notify = (input: {
      threadId: string;
      title: string;
      body: string;
      severity: "info" | "warning" | "error" | "success";
    }) => {
      const isCurrentThread = currentThreadId === input.threadId;
      if (isCurrentThread && document.hasFocus()) {
        return;
      }

      const delivery = shouldNotify({
        type:
          input.severity === "success"
            ? "completed"
            : input.severity === "error"
              ? "error"
              : "needs-input",
        enabled,
        permission,
        documentHasFocus: document.hasFocus(),
      });

      if (delivery.native) {
        const notification = new Notification(input.title, {
          body: input.body,
          tag: `${input.threadId}:${input.title}`,
        });
        notification.addEventListener("click", () => {
          window.focus();
          void navigate({
            to: "/$threadId",
            params: { threadId: input.threadId },
          });
          notification.close();
        });
        return;
      }

      if (delivery.toast) {
        toastManager.add({
          type: input.severity,
          title: input.title,
          description: input.body,
          actionProps: {
            children: "Open",
            onClick: () =>
              void navigate({
                to: "/$threadId",
                params: { threadId: input.threadId },
              }),
          },
        });
      }
    };

    for (const thread of threads) {
      const latestActivity = thread.activities.at(-1);
      if (latestActivity) {
        updateLastActivity(thread.id, latestActivity.createdAt);
      }

      for (const activity of thread.activities) {
        if (seenActivityIdsRef.current.has(activity.id)) {
          continue;
        }
        seenActivityIdsRef.current.add(activity.id);

        if (activity.kind === "user-input.requested" || activity.kind === "approval.requested") {
          const content = formatNotificationBody("needs-input", activity.summary);
          notify({
            threadId: thread.id,
            title: content.title,
            body: content.body,
            severity: "warning",
          });
          continue;
        }

        if (activity.kind === "runtime.error") {
          const content = formatNotificationBody("error", activity.summary);
          notify({
            threadId: thread.id,
            title: content.title,
            body: content.body,
            severity: "error",
          });
        }
      }

      const completedAt = thread.latestTurn?.completedAt ?? null;
      if (!completedAt) {
        continue;
      }

      const completionKey = `${thread.id}:${thread.latestTurn?.turnId ?? completedAt}`;
      if (seenCompletedTurnsRef.current.has(completionKey)) {
        continue;
      }
      seenCompletedTurnsRef.current.add(completionKey);

      const lastVisitedAt = threadLastVisitedAtById[thread.id];
      if (lastVisitedAt && completedAt <= lastVisitedAt) {
        continue;
      }

      const content = formatNotificationBody("completed", thread.title);
      notify({
        threadId: thread.id,
        title: content.title,
        body: content.body,
        severity: "success",
      });
    }
  }, [
    currentThreadId,
    enabled,
    navigate,
    permission,
    threadLastVisitedAtById,
    threads,
    updateLastActivity,
  ]);

  return null;
}
