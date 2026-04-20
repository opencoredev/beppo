import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOTIFICATION_ENABLED_STORAGE_KEY } from "./notificationStore";

function createWindowStub() {
  const storage = new Map<string, string>();

  return {
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
    vi.stubGlobal("window", createWindowStub());
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
});
