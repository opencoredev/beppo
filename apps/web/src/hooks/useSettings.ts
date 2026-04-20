/**
 * Unified settings hook.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
 *
 * Consumers use `useSettings(selector)` to read, and `useUpdateSettings()` to
 * write. The hook transparently routes reads/writes to the correct backing
 * store.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  type ServerConfig,
  ServerSettings,
  ServerSettingsPatch,
  ModelSelection,
  ThreadEnvMode,
} from "@t3tools/contracts";
import {
  type ClientSettings,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
  TimestampFormat,
  UnifiedSettings,
} from "@t3tools/contracts/settings";
import { ensureNativeApi } from "~/nativeApi";
import { useLocalStorage } from "./useLocalStorage";
import { normalizeCustomModelSlugs } from "~/modelSelection";
import { Equal, Predicate, Schema, Struct } from "effect";
import { DeepMutable } from "effect/Types";
import { deepMerge } from "@t3tools/shared/Struct";
import {
  applySettingsUpdated,
  getServerConfig,
  useServerConfig,
  useServerSettings,
} from "~/rpc/serverState";
import { toastManager } from "~/components/ui/toast";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
const OLD_SETTINGS_KEY = "t3code:app-settings:v1";

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: Partial<UnifiedSettings>): {
  serverPatch: ServerSettingsPatch;
  clientPatch: Partial<ClientSettings>;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as Partial<ClientSettings>,
  };
}

// ── Optimistic server settings snapshot ──────────────────────────────

let optimisticServerSettingsSnapshot: ServerSettings | null = null;
const optimisticServerSettingsListeners = new Set<() => void>();

function getOptimisticServerSettingsSnapshot(): ServerSettings | null {
  return optimisticServerSettingsSnapshot;
}

function setOptimisticServerSettingsSnapshot(next: ServerSettings | null): void {
  if (Object.is(optimisticServerSettingsSnapshot, next)) {
    return;
  }
  optimisticServerSettingsSnapshot = next;
  for (const listener of optimisticServerSettingsListeners) {
    listener();
  }
}

function subscribeOptimisticServerSettings(listener: () => void): () => void {
  optimisticServerSettingsListeners.add(listener);
  return () => {
    optimisticServerSettingsListeners.delete(listener);
  };
}

export function resolveVisibleServerSettings({
  serverSettings,
  optimisticServerSettings,
}: {
  serverSettings: ServerSettings;
  optimisticServerSettings: ServerSettings | null;
}): ServerSettings {
  return optimisticServerSettings ?? serverSettings;
}

export function applyServerSettingsPatchPreview(
  currentSettings: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  return deepMerge(currentSettings, patch);
}

export async function updateUnifiedSettings(
  patch: Partial<UnifiedSettings>,
  deps: {
    getServerConfig: () => ServerConfig | null;
    getOptimisticServerSettings: () => ServerSettings | null;
    setOptimisticServerSettings: (settings: ServerSettings | null) => void;
    applyServerSettings: (settings: ServerSettings) => void;
    setClientSettings: (updater: (previous: ClientSettings) => ClientSettings) => void;
    updateServerSettings: (serverPatch: ServerSettingsPatch) => Promise<ServerSettings>;
    addToast: (input: { type: "error"; title: string; description: string }) => void;
  },
): Promise<void> {
  const { serverPatch, clientPatch } = splitPatch(patch);

  if (Object.keys(clientPatch).length > 0) {
    deps.setClientSettings((previous) => ({ ...previous, ...clientPatch }));
  }

  if (Object.keys(serverPatch).length === 0) {
    return;
  }

  const serverConfig = deps.getServerConfig();
  const previousOptimisticServerSettings = deps.getOptimisticServerSettings();
  const shouldClearOptimisticServerSettingsOnFailure =
    serverConfig === null && previousOptimisticServerSettings === null;
  const previousServerSettings =
    serverConfig?.settings ?? previousOptimisticServerSettings ?? DEFAULT_SERVER_SETTINGS;
  const nextServerSettings = applyServerSettingsPatchPreview(previousServerSettings, serverPatch);

  if (serverConfig) {
    deps.applyServerSettings(nextServerSettings);
  } else {
    deps.setOptimisticServerSettings(nextServerSettings);
  }

  try {
    const updatedServerSettings = await deps.updateServerSettings(serverPatch);
    if (deps.getServerConfig()) {
      deps.applyServerSettings(updatedServerSettings);
    } else {
      deps.setOptimisticServerSettings(updatedServerSettings);
    }
  } catch (error) {
    if (deps.getServerConfig()) {
      deps.applyServerSettings(previousServerSettings);
    } else if (shouldClearOptimisticServerSettingsOnFailure) {
      deps.setOptimisticServerSettings(null);
    } else {
      deps.setOptimisticServerSettings(previousServerSettings);
    }

    deps.addToast({
      type: "error",
      title: "Could not save settings",
      description:
        error instanceof Error ? error.message : "We could not save those settings changes.",
    });
  }
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Read merged settings. Selector narrows the subscription so components
 * only re-render when the slice they care about changes.
 */

export function useSettings<T extends UnifiedSettings = UnifiedSettings>(
  selector?: (s: UnifiedSettings) => T,
): T {
  const serverConfig = useServerConfig();
  const serverSettings = useServerSettings();
  const optimisticServerSettings = useSyncExternalStore(
    subscribeOptimisticServerSettings,
    getOptimisticServerSettingsSnapshot,
    getOptimisticServerSettingsSnapshot,
  );
  useEffect(() => {
    if (serverConfig === null || optimisticServerSettings === null) {
      return;
    }
    if (Equal.equals(serverSettings, optimisticServerSettings)) {
      setOptimisticServerSettingsSnapshot(null);
    }
  }, [optimisticServerSettings, serverConfig, serverSettings]);
  const [clientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const merged = useMemo<UnifiedSettings>(
    () => ({
      ...resolveVisibleServerSettings({
        serverSettings,
        optimisticServerSettings,
      }),
      ...clientSettings,
    }),
    [clientSettings, optimisticServerSettings, serverSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Client keys go straight to localStorage.
 */
export function useUpdateSettings() {
  const [, setClientSettings] = useLocalStorage(
    CLIENT_SETTINGS_STORAGE_KEY,
    DEFAULT_CLIENT_SETTINGS,
    ClientSettingsSchema,
  );

  const updateSettings = useCallback(
    async (patch: Partial<UnifiedSettings>) => {
      await updateUnifiedSettings(patch, {
        getServerConfig,
        getOptimisticServerSettings: getOptimisticServerSettingsSnapshot,
        setOptimisticServerSettings: setOptimisticServerSettingsSnapshot,
        applyServerSettings: applySettingsUpdated,
        setClientSettings,
        updateServerSettings: (serverPatch) => ensureNativeApi().server.updateSettings(serverPatch),
        addToast: (input) => {
          toastManager.add(input);
        },
      });
    },
    [setClientSettings],
  );

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_UNIFIED_SETTINGS);
  }, [updateSettings]);

  return {
    updateSettings,
    resetSettings,
  };
}

// ── One-time migration from localStorage ─────────────────────────────

export function buildLegacyServerSettingsMigrationPatch(legacySettings: Record<string, unknown>) {
  const patch: DeepMutable<ServerSettingsPatch> = {};

  if (Predicate.isBoolean(legacySettings.enableAssistantStreaming)) {
    patch.enableAssistantStreaming = legacySettings.enableAssistantStreaming;
  }

  if (Schema.is(ThreadEnvMode)(legacySettings.defaultThreadEnvMode)) {
    patch.defaultThreadEnvMode = legacySettings.defaultThreadEnvMode;
  }

  if (Schema.is(ModelSelection)(legacySettings.textGenerationModelSelection)) {
    patch.textGenerationModelSelection = legacySettings.textGenerationModelSelection;
  }

  if (typeof legacySettings.codexBinaryPath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.binaryPath = legacySettings.codexBinaryPath;
  }

  if (typeof legacySettings.codexHomePath === "string") {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.homePath = legacySettings.codexHomePath;
  }

  if (Array.isArray(legacySettings.customCodexModels)) {
    patch.providers ??= {};
    patch.providers.codex ??= {};
    patch.providers.codex.customModels = normalizeCustomModelSlugs(
      legacySettings.customCodexModels,
      new Set<string>(),
      "codex",
    );
  }

  if (Predicate.isString(legacySettings.claudeBinaryPath)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.binaryPath = legacySettings.claudeBinaryPath;
  }

  if (Array.isArray(legacySettings.customClaudeModels)) {
    patch.providers ??= {};
    patch.providers.claudeAgent ??= {};
    patch.providers.claudeAgent.customModels = normalizeCustomModelSlugs(
      legacySettings.customClaudeModels,
      new Set<string>(),
      "claudeAgent",
    );
  }

  return patch;
}

export function buildLegacyClientSettingsMigrationPatch(
  legacySettings: Record<string, unknown>,
): Partial<DeepMutable<ClientSettings>> {
  const patch: Partial<DeepMutable<ClientSettings>> = {};

  if (Predicate.isBoolean(legacySettings.confirmThreadArchive)) {
    patch.confirmThreadArchive = legacySettings.confirmThreadArchive;
  }

  if (Predicate.isBoolean(legacySettings.confirmThreadDelete)) {
    patch.confirmThreadDelete = legacySettings.confirmThreadDelete;
  }

  if (Predicate.isBoolean(legacySettings.diffWordWrap)) {
    patch.diffWordWrap = legacySettings.diffWordWrap;
  }

  if (Schema.is(SidebarProjectSortOrder)(legacySettings.sidebarProjectSortOrder)) {
    patch.sidebarProjectSortOrder = legacySettings.sidebarProjectSortOrder;
  }

  if (Schema.is(SidebarThreadSortOrder)(legacySettings.sidebarThreadSortOrder)) {
    patch.sidebarThreadSortOrder = legacySettings.sidebarThreadSortOrder;
  }

  if (Schema.is(TimestampFormat)(legacySettings.timestampFormat)) {
    patch.timestampFormat = legacySettings.timestampFormat;
  }

  return patch;
}

/**
 * Call once on app startup.
 * If the legacy localStorage key exists, migrate its values to the new server
 * and client storage formats, then remove the legacy key so this only runs once.
 */
export function migrateLocalSettingsToServer(): void {
  if (typeof window === "undefined") return;

  const raw = localStorage.getItem(OLD_SETTINGS_KEY);
  if (!raw) return;

  try {
    const old = JSON.parse(raw);
    if (!Predicate.isObject(old)) return;

    // Migrate server-relevant keys via RPC
    const serverPatch = buildLegacyServerSettingsMigrationPatch(old);
    if (Object.keys(serverPatch).length > 0) {
      const api = ensureNativeApi();
      void api.server.updateSettings(serverPatch);
    }

    // Migrate client-only keys to the new localStorage key
    const clientPatch = buildLegacyClientSettingsMigrationPatch(old);
    if (Object.keys(clientPatch).length > 0) {
      const existing = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
      const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
      localStorage.setItem(
        CLIENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ ...current, ...clientPatch }),
      );
    }
  } catch (error) {
    console.error("[MIGRATION] Error migrating local settings:", error);
  } finally {
    // Remove the legacy key regardless to keep migration one-shot behavior.
    localStorage.removeItem(OLD_SETTINGS_KEY);
  }
}
