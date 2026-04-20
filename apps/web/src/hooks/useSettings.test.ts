import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  applyServerSettingsPatchPreview,
  buildLegacyClientSettingsMigrationPatch,
  resolveVisibleServerSettings,
  updateUnifiedSettings,
} from "./useSettings";

const baseServerConfig: ServerConfig = {
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  settings: DEFAULT_SERVER_SETTINGS,
};

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });
});

describe("resolveVisibleServerSettings", () => {
  it("prefers optimistic settings before the first server snapshot arrives", () => {
    const optimistic = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };

    expect(
      resolveVisibleServerSettings({
        serverSettings: DEFAULT_SERVER_SETTINGS,
        optimisticServerSettings: optimistic,
      }),
    ).toEqual(optimistic);
  });
});

describe("applyServerSettingsPatchPreview", () => {
  it("merges server patches over the current settings snapshot", () => {
    expect(
      applyServerSettingsPatchPreview(DEFAULT_SERVER_SETTINGS, {
        enableAssistantStreaming: true,
        providers: {
          codex: {
            enabled: false,
          },
        },
      }),
    ).toEqual({
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          enabled: false,
        },
      },
    });
  });
});

describe("updateUnifiedSettings", () => {
  it("keeps optimistic server settings visible until the RPC resolves", async () => {
    const optimisticServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };
    let clientSettings = DEFAULT_CLIENT_SETTINGS;
    const setClientSettings = vi.fn(
      (updater: (value: typeof DEFAULT_CLIENT_SETTINGS) => typeof DEFAULT_CLIENT_SETTINGS) => {
        clientSettings = updater(clientSettings);
      },
    );
    const setOptimisticServerSettings = vi.fn();
    const applyServerSettings = vi.fn();
    const updateServerSettings = vi.fn().mockResolvedValue(optimisticServerSettings);
    const addToast = vi.fn();

    await updateUnifiedSettings(
      {
        enableAssistantStreaming: true,
        confirmThreadDelete: false,
      },
      {
        getServerConfig: () => null,
        getOptimisticServerSettings: () => null,
        setOptimisticServerSettings,
        applyServerSettings,
        setClientSettings,
        updateServerSettings,
        addToast,
      },
    );

    expect(clientSettings.confirmThreadDelete).toBe(false);
    expect(setOptimisticServerSettings).toHaveBeenNthCalledWith(1, optimisticServerSettings);
    expect(setOptimisticServerSettings).toHaveBeenNthCalledWith(2, optimisticServerSettings);
    expect(applyServerSettings).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic server patch when the RPC rejects", async () => {
    const previousServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: false,
    };
    let clientSettings = DEFAULT_CLIENT_SETTINGS;
    const setClientSettings = vi.fn(
      (updater: (value: typeof DEFAULT_CLIENT_SETTINGS) => typeof DEFAULT_CLIENT_SETTINGS) => {
        clientSettings = updater(clientSettings);
      },
    );
    const applyServerSettings = vi.fn();
    const updateServerSettings = vi.fn().mockRejectedValue(new Error("RPC failed"));
    const addToast = vi.fn();

    await updateUnifiedSettings(
      {
        enableAssistantStreaming: true,
      },
      {
        getServerConfig: () => ({ ...baseServerConfig, settings: previousServerSettings }),
        getOptimisticServerSettings: () => null,
        setOptimisticServerSettings: vi.fn(),
        applyServerSettings,
        setClientSettings,
        updateServerSettings,
        addToast,
      },
    );

    expect(applyServerSettings).toHaveBeenNthCalledWith(1, {
      ...previousServerSettings,
      enableAssistantStreaming: true,
    });
    expect(applyServerSettings).toHaveBeenNthCalledWith(2, previousServerSettings);
    expect(clientSettings).toEqual(DEFAULT_CLIENT_SETTINGS);
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Could not save settings",
        description: "RPC failed",
      }),
    );
  });
});
