import { create } from "zustand";

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

function getInitialPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  permission: getInitialPermission(),
  enabled: false,
  lastActivityByThread: {},

  setEnabled: (enabled) => {
    set({ enabled });
  },

  requestPermission: async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      set({ permission: "unsupported" });
      return;
    }
    const result = await Notification.requestPermission();
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
