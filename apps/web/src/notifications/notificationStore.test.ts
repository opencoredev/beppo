import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_ENABLED_STORAGE_KEY } from "./notificationStore";

function createWindowStub() {
  const storage = new Map<string, string>();
  const notificationStub = {
    permission: "granted" as NotificationPermission,
    requestPermission: vi.fn(async () => "granted" as NotificationPermission),
    prototype: {},
  } as unknown as typeof Notification;

  return {
    Notification: notificationStub,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    },
  };
}

describe("useNotificationStore", () => {
  beforeEach(() => {
    vi.resetModules();
    const windowStub = createWindowStub();
    vi.stubGlobal("window", windowStub);
    vi.stubGlobal("Notification", windowStub.Notification);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists enabled state across reloads", async () => {
    const windowStub = window as typeof globalThis.window & {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        clear: () => void;
      };
    };
    const { useNotificationStore } = await import("./notificationStore");

    expect(useNotificationStore.getState().enabled).toBe(false);

    useNotificationStore.getState().setEnabled(true);

    expect(windowStub.localStorage.getItem(NOTIFICATION_ENABLED_STORAGE_KEY)).toBe(
      JSON.stringify({ enabled: true }),
    );

    vi.resetModules();
    const { useNotificationStore: reloadedNotificationStore } = await import("./notificationStore");

    expect(reloadedNotificationStore.getState().enabled).toBe(true);
  });

  it("falls back to disabled when persisted data is malformed", async () => {
    const windowStub = window as typeof globalThis.window & {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        clear: () => void;
      };
    };
    windowStub.localStorage.setItem(NOTIFICATION_ENABLED_STORAGE_KEY, "{not-json");

    const { useNotificationStore } = await import("./notificationStore");

    expect(useNotificationStore.getState().enabled).toBe(false);
  });

  it("disables notifications on reload when permission was revoked externally", async () => {
    const windowStub = window as typeof globalThis.window & {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
        clear: () => void;
      };
      Notification: typeof Notification;
    };

    windowStub.localStorage.setItem(
      NOTIFICATION_ENABLED_STORAGE_KEY,
      JSON.stringify({ enabled: true }),
    );
    const deniedNotification = {
      permission: "denied" as NotificationPermission,
      requestPermission: vi.fn(async () => "denied" as NotificationPermission),
      prototype: {},
    } as unknown as typeof Notification;
    vi.stubGlobal("Notification", deniedNotification);
    windowStub.Notification = deniedNotification;

    const { useNotificationStore } = await import("./notificationStore");

    expect(useNotificationStore.getState().permission).toBe("denied");
    expect(useNotificationStore.getState().enabled).toBe(false);
  });
});
