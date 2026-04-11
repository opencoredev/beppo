const DEFAULT_STUCK_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Check if the last activity is older than the threshold.
 */
export function isStuck(
  lastActivityAt: string,
  now: Date,
  thresholdMs = DEFAULT_STUCK_THRESHOLD_MS,
): boolean {
  const lastTime = new Date(lastActivityAt).getTime();
  if (Number.isNaN(lastTime)) return false;
  return now.getTime() - lastTime > thresholdMs;
}

interface ShouldNotifyOptions {
  type: "needs-input" | "stuck" | "error" | "completed";
  enabled: boolean;
  permission: NotificationPermission | "unsupported";
  documentHasFocus: boolean;
}

interface NotifyResult {
  native: boolean;
  toast: boolean;
}

/**
 * Determine whether to send a native OS notification, an in-app toast, or neither.
 */
export function shouldNotify(opts: ShouldNotifyOptions): NotifyResult {
  if (!opts.enabled) return { native: false, toast: false };

  const canNative = opts.permission === "granted" && !opts.documentHasFocus;

  return {
    native: canNative,
    toast: !canNative,
  };
}

interface NotificationContent {
  title: string;
  body: string;
}

/**
 * Format human-readable notification content for each notification type.
 */
export function formatNotificationBody(
  type: "needs-input" | "stuck" | "error" | "completed",
  detail?: string,
): NotificationContent {
  switch (type) {
    case "needs-input":
      return {
        title: "Agent needs your input",
        body: detail ?? "The agent is waiting for your approval or answer.",
      };
    case "stuck":
      return {
        title: "Agent might be stuck",
        body: detail ?? "No activity detected for over 3 minutes.",
      };
    case "error":
      return {
        title: "Agent error",
        body: detail ?? "An error occurred during agent execution.",
      };
    case "completed":
      return {
        title: "Agent finished",
        body: detail ? `"${detail}" completed.` : "The agent finished its latest turn.",
      };
  }
}
