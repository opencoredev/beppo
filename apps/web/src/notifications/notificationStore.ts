import { create } from "zustand";

export const NOTIFICATION_ENABLED_STORAGE_KEY = "beppo:notification-settings:v1";

interface NotificationState {
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
  lastActivityByThread: Record<string, string>;
}

interface NotificationStore extends NotificationState {
  setEnabled: (enabled: boolean) => void;
  requestPermission: () => Promise<void>;
  updateLastActivity: (threadId: string, timestamp: string) => void;
}

function getNotificationStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getInitialPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function readInitialEnabledState(): boolean {
  const storage = getNotificationStorage();
  if (!storage) return false;

  try {
    const raw = storage.getItem(NOTIFICATION_ENABLED_STORAGE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return false;
    if (!("enabled" in parsed)) return false;
    return (parsed as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

function persistEnabledState(enabled: boolean) {
  const storage = getNotificationStorage();
  if (!storage) return;

  try {
    storage.setItem(NOTIFICATION_ENABLED_STORAGE_KEY, JSON.stringify({ enabled }));
  } catch {
    // Ignore storage failures so notification toggles never break the UI.
  }
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  permission: getInitialPermission(),
  enabled: readInitialEnabledState(),
  lastActivityByThread: {},

  setEnabled: (enabled) => {
    persistEnabledState(enabled);
    set({ enabled });
  },

  requestPermission: async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      set({ permission: "unsupported" });
      return;
    }
    const result = await Notification.requestPermission();
    persistEnabledState(result === "granted");
    set({ permission: result, enabled: result === "granted" });
  },

  updateLastActivity: (threadId, timestamp) => {
    set((state) => ({
      lastActivityByThread: {
        ...state.lastActivityByThread,
        [threadId]: timestamp,
      },
    }));
  },
}));
