import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as Net from "node:net";
import * as OS from "node:os";
import * as Path from "node:path";

import desktopPackageJson from "../package.json" with { type: "json" };

import Electrobun, {
  ApplicationMenu,
  BrowserWindow,
  ContextMenu,
  Updater,
  Utils,
} from "./electrobun-runtime";
import * as Effect from "effect/Effect";
import type {
  ContextMenuItem,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { NetService } from "@t3tools/shared/Net";
import {
  APP_BUNDLE_IDENTIFIER,
  APP_HIDDEN_DIR,
  DESKTOP_WS_URL_SEARCH_PARAM,
  LEGACY_DESKTOP_WS_URL_SEARCH_PARAM,
} from "@t3tools/shared/branding";
import { RotatingFileSink } from "@t3tools/shared/logging";
import { resolveWindowsWslHomePathSync } from "@t3tools/shared/wsl";

import { showDesktopConfirmDialog } from "./confirmDialog";
import { fixPath } from "./fixPath";
import {
  createInitialDesktopUpdateState,
  reduceDesktopUpdateStateOnCheckFailure,
  reduceDesktopUpdateStateOnCheckStart,
  reduceDesktopUpdateStateOnDownloadComplete,
  reduceDesktopUpdateStateOnDownloadFailure,
  reduceDesktopUpdateStateOnDownloadProgress,
  reduceDesktopUpdateStateOnDownloadStart,
  reduceDesktopUpdateStateOnInstallFailure,
  reduceDesktopUpdateStateOnNoUpdate,
  reduceDesktopUpdateStateOnUpdateAvailable,
} from "./updateMachine";
import { resolveDesktopRuntimeInfo } from "./runtimeArch";

fixPath();

const PICK_FOLDER_METHOD = "pickFolder";
const CONFIRM_METHOD = "confirm";
const CONTEXT_MENU_METHOD = "showContextMenu";
const OPEN_EXTERNAL_METHOD = "openExternal";
const UPDATE_GET_STATE_METHOD = "getUpdateState";
const UPDATE_DOWNLOAD_METHOD = "downloadUpdate";
const UPDATE_INSTALL_METHOD = "installUpdate";
const MICROPHONE_OPEN_SYSTEM_SETTINGS_METHOD = "microphone.openSystemSettings";

const MENU_ACTION_EVENT = "menu-action";
const UPDATE_STATE_EVENT = "update-state";

// ---------------------------------------------------------------------------
// T3CODE_STATE_DIR backward-compatibility
// ---------------------------------------------------------------------------
// The old env var `T3CODE_STATE_DIR` pointed directly at the state directory,
// whereas `T3CODE_HOME` points at the parent base directory with `userdata/`
// appended.  If the caller still uses the legacy var, derive BASE_DIR so that
// `Path.join(BASE_DIR, "userdata")` resolves to the same location.
// ---------------------------------------------------------------------------
function resolveBaseDirectory(): string {
  const home = process.env.T3CODE_HOME?.trim();
  if (home) return home;

  const legacyStateDir = process.env.T3CODE_STATE_DIR?.trim();
  if (legacyStateDir) {
    console.warn(
      "[desktop] T3CODE_STATE_DIR is deprecated and will be removed in a future release. " +
        "Use T3CODE_HOME instead (the parent of the userdata directory). " +
        `Mapping T3CODE_STATE_DIR="${legacyStateDir}" → T3CODE_HOME="${Path.dirname(legacyStateDir)}"`,
    );
    // T3CODE_STATE_DIR pointed at the state dir itself (e.g. ~/.t3/userdata).
    // BASE_DIR should be the parent so that Path.join(BASE_DIR, "userdata")
    // matches the original path.
    return Path.dirname(legacyStateDir);
  }

  return Path.join(OS.homedir(), APP_HIDDEN_DIR);
}

const BASE_DIR = resolveBaseDirectory();
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const ROOT_DIR = Path.resolve(import.meta.dir, "..");
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
// In electrobun dev mode, import.meta.dir resolves inside the .app bundle, not the repo.
// The dev-runner passes T3CODE_REPO_ROOT so we can locate source files for the backend.
const REPO_ROOT_DIR = process.env.T3CODE_REPO_ROOT || ROOT_DIR;
const externalDevBackendWsUrl = process.env.VITE_WS_URL?.trim() || "";
const useExternalDevBackend = isDevelopment && externalDevBackendWsUrl.length > 0;
const APP_DISPLAY_NAME = isDevelopment
  ? "Beppo (Dev)"
  : (desktopPackageJson.productName ?? "Beppo");
const LOG_DIR = Path.join(STATE_DIR, "logs");
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_MAX_FILES = 10;
const APP_RUN_ID = Crypto.randomBytes(6).toString("hex");
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;
const isWslRuntime =
  Boolean(process.env.WSL_DISTRO_NAME) || OS.release().toLowerCase().includes("microsoft");
const useCefRenderer = !isDevelopment;

type DesktopUpdateErrorContext = DesktopUpdateState["errorContext"];

interface DesktopBridgeRequestEnvelope {
  readonly kind: "request";
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

interface DesktopBridgeResponseEnvelope {
  readonly kind: "response";
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

interface DesktopBridgeEventEnvelope {
  readonly kind: "event";
  readonly event: string;
  readonly payload: unknown;
}

interface PendingContextMenuRequest {
  readonly resolve: (value: string | null) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

type DesktopWindow = InstanceType<typeof BrowserWindow>;
type UpdaterStatusEntry = {
  readonly status: string;
  readonly message: string;
  readonly details?: { progress?: number };
};

let mainWindow: DesktopWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";
let restartAttempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let isQuitting = false;
let desktopLogSink: RotatingFileSink | null = null;
let backendLogSink: RotatingFileSink | null = null;
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateState: DesktopUpdateState;

const pendingContextMenus = new Map<string, PendingContextMenuRequest>();

function logTimestamp(): string {
  return new Date().toISOString();
}

function logScope(scope: string): string {
  return `${scope} run=${APP_RUN_ID}`;
}

function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Mask a secret value for safe logging.  Shows the first 4 characters
 * followed by `***` so operators can correlate values without exposing
 * the full secret.  Returns `"<empty>"` for blank strings.
 */
function maskSecret(value: string): string {
  if (value.length === 0) return "<empty>";
  return `${value.slice(0, 4)}***`;
}

function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.T3CODE_PORT;
  delete env.T3CODE_AUTH_TOKEN;
  delete env.T3CODE_MODE;
  delete env.T3CODE_NO_BROWSER;
  delete env.T3CODE_HOST;
  delete env.T3CODE_DESKTOP_WS_URL;
  return env;
}

function writeDesktopLog(message: string): void {
  if (!desktopLogSink) return;
  desktopLogSink.write(`[${logTimestamp()}] [${logScope("desktop")}] ${message}\n`);
}

function writeBackendSessionBoundary(phase: "START" | "END", details: string): void {
  if (!backendLogSink) return;
  backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${APP_RUN_ID} ${sanitizeLogValue(details)} ----\n`,
  );
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openMicrophoneSystemSettings(): Promise<boolean> {
  const url =
    process.platform === "darwin"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
      : process.platform === "win32"
        ? "ms-settings:privacy-microphone"
        : null;

  if (!url) {
    return false;
  }

  try {
    return Boolean(await Utils.openExternal(url));
  } catch {
    return false;
  }
}

/**
 * Validate and sanitize an external URL for safe opening.
 * Only https:// URLs are allowed in production; http:// is additionally
 * permitted in development mode for local tooling.
 */
function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol === "https:") {
    return parsedUrl.toString();
  }

  if (parsedUrl.protocol === "http:" && isDevelopment) {
    return parsedUrl.toString();
  }

  return null;
}

function resolveAppBundlePath(): string | null {
  if (process.platform !== "darwin") return null;

  const executablePath = process.argv0?.trim();
  if (!executablePath) return null;

  const bundlePath = Path.resolve(executablePath, "../../..");
  return bundlePath.endsWith(".app") ? bundlePath : null;
}

function initializeLogging(): void {
  try {
    desktopLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "desktop-main.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
    backendLogSink = new RotatingFileSink({
      filePath: Path.join(LOG_DIR, "server-child.log"),
      maxBytes: LOG_FILE_MAX_BYTES,
      maxFiles: LOG_FILE_MAX_FILES,
    });
  } catch (error) {
    console.error("[desktop] failed to initialize logging", error);
  }
}

function captureBackendOutput(child: ChildProcess.ChildProcess): void {
  if (!backendLogSink) return;
  const writeChunk = (chunk: unknown): void => {
    if (!backendLogSink) return;
    backendLogSink.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
  };
  child.stdout?.on("data", writeChunk);
  child.stderr?.on("data", writeChunk);
}

function resolveBackendEntry(): string {
  if (isDevelopment) {
    // In dev mode, run from source via bun (repo root, not .app bundle)
    return Path.join(REPO_ROOT_DIR, "apps/server/src/bin.ts");
  }
  // In production, the server dist is copied into the .app bundle
  return Path.join(ROOT_DIR, "apps/server/dist/bin.mjs");
}

function resolveWindowUrl(): string {
  const baseUrl = isDevelopment
    ? process.env.VITE_DEV_SERVER_URL
    : (() => {
        if (!backendPort) {
          throw new Error("Desktop runtime missing backend port.");
        }
        return `http://127.0.0.1:${backendPort}/`;
      })();

  if (!baseUrl) {
    throw new Error("Desktop runtime missing VITE_DEV_SERVER_URL.");
  }

  const resolved = new URL(baseUrl);
  resolved.searchParams.set(DESKTOP_WS_URL_SEARCH_PARAM, backendWsUrl);
  resolved.searchParams.set(LEGACY_DESKTOP_WS_URL_SEARCH_PARAM, backendWsUrl);
  return resolved.toString();
}

function resolvePreloadPath(): string {
  return Path.join(ROOT_DIR, "preload.js");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpUrl(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const remaining = timeoutMs - (Date.now() - startedAt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5_000, remaining));
      try {
        const response = await fetch(url, { method: "GET", signal: controller.signal });
        if (response.ok) {
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for desktop dev URL ${url}: ${formatErrorMessage(lastError)}`);
}

async function waitForTcpEndpoint(url: string, timeoutMs: number): Promise<void> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const portStr = parsed.port;

  if (!host || !portStr) {
    return;
  }

  const port = Number(portStr);

  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = Net.createConnection({ host, port });
        const cleanup = () => {
          socket.removeAllListeners();
          socket.destroy();
        };

        socket.once("connect", () => {
          cleanup();
          resolve();
        });
        socket.once("error", (error) => {
          cleanup();
          reject(error);
        });
      });
      return;
    } catch (error) {
      lastError = error;
    }

    await sleep(150);
  }

  throw new Error(
    `Timed out waiting for desktop dev backend ${url}: ${formatErrorMessage(lastError)}`,
  );
}

function activateMacAppBundle(): void {
  if (process.platform !== "darwin") return;

  try {
    const child = ChildProcess.spawn("open", ["-b", APP_BUNDLE_IDENTIFIER], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    writeDesktopLog(`requested app activation bundleId=${APP_BUNDLE_IDENTIFIER}`);
  } catch (error) {
    const bundlePath = resolveAppBundlePath();
    if (!bundlePath) {
      writeDesktopLog(`app activation failed error=${formatErrorMessage(error)}`);
      return;
    }

    try {
      const child = ChildProcess.spawn("open", ["-a", bundlePath], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      writeDesktopLog(`requested app activation bundle=${bundlePath}`);
    } catch (fallbackError) {
      writeDesktopLog(`app activation failed error=${formatErrorMessage(fallbackError)}`);
    }
  }
}

function createResponse(
  id: string,
  input:
    | { readonly ok: true; readonly result?: unknown }
    | { readonly ok: false; readonly error: string },
): DesktopBridgeResponseEnvelope {
  return input.ok
    ? {
        kind: "response",
        id,
        ok: true,
        ...(input.result !== undefined ? { result: input.result } : {}),
      }
    : { kind: "response", id, ok: false, error: input.error };
}

function sendBridgeMessage(
  message: DesktopBridgeResponseEnvelope | DesktopBridgeEventEnvelope,
): void {
  if (!mainWindow) return;
  mainWindow.webview.sendMessageToWebviewViaExecute(message);
}

function broadcastBridgeEvent(event: string, payload: unknown): void {
  sendBridgeMessage({ kind: "event", event, payload });
}

function emitUpdateState(): void {
  broadcastBridgeEvent(UPDATE_STATE_EVENT, updateState);
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function clearUpdateTimers(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

function normalizeUpdaterErrorContext(): DesktopUpdateErrorContext {
  if (updateDownloadInFlight) return "download";
  if (updateCheckInFlight) return "check";
  return updateState.errorContext;
}

async function resolveAutoUpdateEnabled(): Promise<boolean> {
  if (isDevelopment) return false;

  try {
    const channel = await Updater.localInfo.channel();
    if (channel === "dev") {
      return false;
    }
    await Updater.channelBucketUrl();
    return true;
  } catch {
    return false;
  }
}

function syncUpdateStateFromUpdaterEntry(entry: UpdaterStatusEntry): void {
  switch (entry.status) {
    case "checking": {
      setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));
      return;
    }
    case "no-update": {
      setUpdateState(reduceDesktopUpdateStateOnNoUpdate(updateState, new Date().toISOString()));
      return;
    }
    case "update-available": {
      const availableVersion =
        Updater.updateInfo()?.version ?? updateState.availableVersion ?? "unknown";
      setUpdateState(
        reduceDesktopUpdateStateOnUpdateAvailable(
          updateState,
          availableVersion,
          new Date().toISOString(),
        ),
      );
      return;
    }
    case "download-starting":
    case "downloading":
    case "checking-local-tar":
    case "local-tar-found":
    case "local-tar-missing":
    case "fetching-patch":
    case "patch-found":
    case "patch-not-found":
    case "downloading-patch":
    case "applying-patch":
    case "patch-applied":
    case "patch-chain-complete":
    case "downloading-full-bundle":
    case "decompressing":
    case "extracting":
    case "replacing-app":
    case "launching-new-version": {
      if (updateState.status !== "downloading") {
        setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));
      }
      if (typeof entry.details?.progress === "number") {
        setUpdateState(
          reduceDesktopUpdateStateOnDownloadProgress(updateState, entry.details.progress),
        );
      }
      return;
    }
    case "download-progress": {
      if (typeof entry.details?.progress === "number") {
        setUpdateState(
          reduceDesktopUpdateStateOnDownloadProgress(updateState, entry.details.progress),
        );
      }
      return;
    }
    case "download-complete":
    case "complete": {
      const version =
        Updater.updateInfo()?.version ?? updateState.availableVersion ?? updateState.currentVersion;
      setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, version));
      return;
    }
    case "error": {
      setUpdateState({
        status: "error",
        message: entry.message,
        checkedAt: new Date().toISOString(),
        downloadPercent: null,
        errorContext: normalizeUpdaterErrorContext(),
        canRetry: updateState.availableVersion !== null || updateState.downloadedVersion !== null,
      });
      return;
    }
    default:
      return;
  }
}

async function checkForUpdates(reason: string): Promise<void> {
  if (isQuitting || !updateState.enabled || updateCheckInFlight) return;
  if (updateState.status === "downloading" || updateState.status === "downloaded") {
    writeDesktopLog(`skipping update check (${reason}) while status=${updateState.status}`);
    return;
  }

  updateCheckInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnCheckStart(updateState, new Date().toISOString()));

  try {
    await Updater.checkForUpdate();
  } catch (error) {
    setUpdateState(
      reduceDesktopUpdateStateOnCheckFailure(
        updateState,
        formatErrorMessage(error),
        new Date().toISOString(),
      ),
    );
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (!updateState.enabled || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false };
  }

  updateDownloadInFlight = true;
  setUpdateState(reduceDesktopUpdateStateOnDownloadStart(updateState));

  try {
    await Updater.downloadUpdate();
    const version =
      Updater.updateInfo()?.version ?? updateState.availableVersion ?? updateState.currentVersion;
    setUpdateState(reduceDesktopUpdateStateOnDownloadComplete(updateState, version));
    return { accepted: true, completed: true };
  } catch (error) {
    setUpdateState(
      reduceDesktopUpdateStateOnDownloadFailure(updateState, formatErrorMessage(error)),
    );
    return { accepted: true, completed: false };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<{ accepted: boolean; completed: boolean }> {
  if (isQuitting || !updateState.enabled || updateState.status !== "downloaded") {
    return { accepted: false, completed: false };
  }

  isQuitting = true;
  clearUpdateTimers();
  try {
    await stopBackendAndWaitForExit();
    await Updater.applyUpdate();
    return { accepted: true, completed: true };
  } catch (error) {
    isQuitting = false;
    setUpdateState(
      reduceDesktopUpdateStateOnInstallFailure(updateState, formatErrorMessage(error)),
    );
    return { accepted: true, completed: false };
  }
}

function configureAutoUpdater(): void {
  if (!updateState.enabled) {
    return;
  }

  Updater.onStatusChange((entry: unknown) => {
    syncUpdateStateFromUpdaterEntry(entry as UpdaterStatusEntry);
  });

  clearUpdateTimers();
  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
}

function backendEnv(): NodeJS.ProcessEnv {
  return {
    ...backendChildEnv(),
    T3CODE_MODE: "desktop",
    T3CODE_NO_BROWSER: "1",
    T3CODE_PORT: String(backendPort),
    T3CODE_STATE_DIR: STATE_DIR,
    T3CODE_AUTH_TOKEN: backendAuthToken,
  };
}

function scheduleBackendRestart(reason: string): void {
  if (isQuitting || restartTimer) return;

  const delayMs = Math.min(500 * 2 ** restartAttempt, 10_000);
  restartAttempt += 1;
  writeDesktopLog(`backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`);

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend();
  }, delayMs);
}

function startBackend(): void {
  if (useExternalDevBackend) return;
  if (isQuitting || backendProcess) return;

  const backendEntry = resolveBackendEntry();
  if (!FS.existsSync(backendEntry)) {
    scheduleBackendRestart(`missing server entry at ${backendEntry}`);
    return;
  }

  const child = ChildProcess.spawn(process.execPath, [backendEntry], {
    cwd: isDevelopment ? REPO_ROOT_DIR : OS.homedir(),
    env: backendEnv(),
    stdio: backendLogSink ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  backendProcess = child;
  let backendSessionClosed = false;
  const closeBackendSession = (details: string) => {
    if (backendSessionClosed) return;
    backendSessionClosed = true;
    writeBackendSessionBoundary("END", details);
  };

  writeBackendSessionBoundary("START", `pid=${child.pid ?? "unknown"} port=${backendPort}`);
  captureBackendOutput(child);

  child.once("spawn", () => {
    restartAttempt = 0;
  });

  child.on("error", (error) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(`pid=${child.pid ?? "unknown"} error=${error.message}`);
    scheduleBackendRestart(error.message);
  });

  child.on("exit", (code, signal) => {
    if (backendProcess === child) {
      backendProcess = null;
    }
    closeBackendSession(
      `pid=${child.pid ?? "unknown"} code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    if (isQuitting) return;
    scheduleBackendRestart(`code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
}

function stopBackend(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);
  }
}

async function stopBackendAndWaitForExit(timeoutMs = 5_000): Promise<void> {
  if (useExternalDevBackend) return;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const child = backendProcess;
  backendProcess = null;
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (exitTimeoutTimer) clearTimeout(exitTimeoutTimer);
      resolve();
    };

    const onExit = () => settle();

    child.once("exit", onExit);
    child.kill("SIGTERM");

    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);

    exitTimeoutTimer = setTimeout(() => {
      settle();
    }, timeoutMs);
  });
}

function actionResult(accepted: boolean, completed: boolean): DesktopUpdateActionResult {
  return {
    accepted,
    completed,
    state: updateState,
  } satisfies DesktopUpdateActionResult;
}

async function handleBridgeRequest(envelope: DesktopBridgeRequestEnvelope): Promise<unknown> {
  switch (envelope.method) {
    case PICK_FOLDER_METHOD: {
      writeDesktopLog("bridge pickFolder start");
      const result: unknown = await Utils.openFileDialog({
        startingFolder:
          process.platform === "win32"
            ? (resolveWindowsWslHomePathSync() ?? OS.homedir())
            : OS.homedir(),
        canChooseFiles: false,
        canChooseDirectory: true,
        canChooseDirectories: true,
        allowsMultipleSelection: false,
      });
      const selected =
        typeof result === "string" && result.trim().length > 0
          ? result
          : Array.isArray(result)
            ? result.find((entry: unknown) => typeof entry === "string" && entry.trim().length > 0)
            : null;
      writeDesktopLog(
        `bridge pickFolder result=${typeof selected === "string" ? selected : "<empty>"}`,
      );
      return selected ?? null;
    }
    case CONFIRM_METHOD: {
      return showDesktopConfirmDialog(typeof envelope.params === "string" ? envelope.params : "");
    }
    case CONTEXT_MENU_METHOD: {
      const params = envelope.params as
        | {
            readonly items?: readonly ContextMenuItem[];
          }
        | undefined;
      const items = Array.isArray(params?.items) ? params.items : [];
      if (items.length === 0) {
        return null;
      }

      return await new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => {
          pendingContextMenus.delete(envelope.id);
          resolve(null);
        }, 30_000);

        pendingContextMenus.set(envelope.id, { resolve, timeout });
        ContextMenu.showContextMenu(
          items.map((item) => {
            if (item.destructive) {
              return {
                label: item.label,
                action: `context-menu:${envelope.id}`,
                data: { itemId: item.id },
                tooltip: "Destructive action",
              };
            }
            return {
              label: item.label,
              action: `context-menu:${envelope.id}`,
              data: { itemId: item.id },
            };
          }),
        );
      });
    }
    case OPEN_EXTERNAL_METHOD: {
      if (typeof envelope.params !== "string" || envelope.params.length === 0) {
        return false;
      }

      const externalUrl = getSafeExternalUrl(envelope.params);
      if (!externalUrl) {
        return false;
      }

      try {
        return Utils.openExternal(externalUrl);
      } catch {
        return false;
      }
    }
    case UPDATE_GET_STATE_METHOD: {
      return updateState;
    }
    case UPDATE_DOWNLOAD_METHOD: {
      const result = await downloadAvailableUpdate();
      return actionResult(result.accepted, result.completed);
    }
    case UPDATE_INSTALL_METHOD: {
      const result = await installDownloadedUpdate();
      return actionResult(result.accepted, result.completed);
    }
    case MICROPHONE_OPEN_SYSTEM_SETTINGS_METHOD: {
      return await openMicrophoneSystemSettings();
    }
    default:
      throw new Error(`Unknown desktop bridge method: ${envelope.method}`);
  }
}

function configureApplicationMenu(): void {
  const fileMenu = {
    label: "File",
    submenu: [
      { label: "Settings...", action: "open-settings", accelerator: "CmdOrCtrl+," },
      { type: "separator" },
      ...(process.platform === "darwin"
        ? [{ role: "close" }]
        : [{ label: "Quit", action: "quit-app", accelerator: "CmdOrCtrl+Q" }]),
    ],
  };

  ApplicationMenu.setApplicationMenu([
    ...(process.platform === "darwin"
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { label: `About ${APP_DISPLAY_NAME}`, role: "about" },
              { type: "separator" },
              { label: "Quit", action: "quit-app", accelerator: "CmdOrCtrl+Q" },
            ],
          },
        ]
      : []),
    fileMenu,
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [{ label: "Check for Updates...", action: "check-for-updates" }],
    },
  ]);

  ApplicationMenu.on("application-menu-clicked", async (event: unknown) => {
    const data = (event as { data?: { action?: string } }).data;
    const action = typeof data?.action === "string" ? data.action : "";

    if (action === "check-for-updates") {
      await checkForUpdates("menu");
      return;
    }

    if (action === "quit-app") {
      await requestApplicationQuit();
      return;
    }

    if (action.length > 0) {
      broadcastBridgeEvent(MENU_ACTION_EVENT, action);
      if (mainWindow) {
        mainWindow.focus();
      }
    }
  });
}

async function requestApplicationQuit(): Promise<void> {
  if (isQuitting) {
    return;
  }

  const confirmed = await showDesktopConfirmDialog(`Quit ${APP_DISPLAY_NAME} now?`);
  if (!confirmed) {
    return;
  }

  isQuitting = true;
  clearUpdateTimers();
  stopBackend();
  Utils.quit();
}

function configureContextMenuListener(): void {
  ContextMenu.on("context-menu-clicked", (event: unknown) => {
    const data = (event as { data?: { action?: string; data?: { itemId?: unknown } } }).data;
    const action = typeof data?.action === "string" ? data.action : "";
    if (!action.startsWith("context-menu:")) {
      return;
    }

    const requestId = action.slice("context-menu:".length);
    const pending = pendingContextMenus.get(requestId);
    if (!pending) {
      return;
    }

    pendingContextMenus.delete(requestId);
    clearTimeout(pending.timeout);
    const itemId = data?.data?.itemId;
    pending.resolve(typeof itemId === "string" ? itemId : null);
  });
}

function createWindow(): DesktopWindow {
  const renderer = useCefRenderer ? "cef" : "native";
  const window = new BrowserWindow({
    title: APP_DISPLAY_NAME,
    frame: {
      x: 60,
      y: 60,
      width: 1100,
      height: 780,
    },
    renderer,
    preload: resolvePreloadPath(),
    titleBarStyle: renderer === "native" && !isWslRuntime ? "hiddenInset" : "default",
    url: resolveWindowUrl(),
    sandbox: false,
  });

  writeDesktopLog(`created window id=${window.id} renderer=${renderer} url=${resolveWindowUrl()}`);

  // Electrobun windows may not become visible automatically on macOS dev launches
  // when started from a terminal, so explicitly show/focus the first window.
  window.show();
  window.focus();
  // In dev mode, skip activateMacAppBundle — calling `open -b <bundle-id>` when the
  // dev-built .app bundle exists on disk causes macOS to spawn a second app instance,
  // resulting in two Beppo windows. The window.show()/focus() above is sufficient for
  // dev-mode visibility. In production the app is launched by the OS normally.
  if (!isDevelopment) {
    activateMacAppBundle();
  }

  window.webview.on("dom-ready", () => {
    writeDesktopLog(`window dom-ready id=${window.id}`);
    window.setTitle(APP_DISPLAY_NAME);
    window.show();
    window.focus();
    emitUpdateState();
  });

  window.webview.rpcHandler = (message: unknown) => {
    const envelope = message as Partial<DesktopBridgeRequestEnvelope>;
    if (
      envelope.kind !== "request" ||
      typeof envelope.id !== "string" ||
      typeof envelope.method !== "string"
    ) {
      return;
    }

    void handleBridgeRequest(envelope as DesktopBridgeRequestEnvelope)
      .then((result) => {
        sendBridgeMessage(createResponse(envelope.id!, { ok: true, result }));
      })
      .catch((error) => {
        sendBridgeMessage(
          createResponse(envelope.id!, { ok: false, error: formatErrorMessage(error) }),
        );
      });
  };

  if (isWslRuntime) {
    window.focus();
  }

  return window;
}

async function bootstrap(): Promise<void> {
  writeDesktopLog("bootstrap start");
  if (useExternalDevBackend) {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (!devUrl) {
      throw new Error("Desktop runtime missing VITE_DEV_SERVER_URL.");
    }
    await Promise.all([
      waitForHttpUrl(devUrl, 15_000),
      waitForTcpEndpoint(externalDevBackendWsUrl, 15_000),
    ]);
    backendWsUrl = externalDevBackendWsUrl;
    writeDesktopLog(`bootstrap using external dev websocket url=${backendWsUrl}`);
  } else {
    backendPort = await Effect.service(NetService).pipe(
      Effect.flatMap((net) => net.reserveLoopbackPort()),
      Effect.provide(NetService.layer),
      Effect.runPromise,
    );
    backendAuthToken = Crypto.randomBytes(24).toString("hex");
    backendWsUrl = `ws://127.0.0.1:${backendPort}/?token=${encodeURIComponent(backendAuthToken)}`;
    writeDesktopLog(
      `bootstrap resolved websocket url=${backendWsUrl} authToken=${maskSecret(backendAuthToken)}`,
    );
    startBackend();
    await waitForHttpUrl(`http://127.0.0.1:${backendPort}/`, 15_000);
  }

  mainWindow = createWindow();
  writeDesktopLog(`bootstrap created main window id=${mainWindow.id}`);
}

function registerLifecycleHandlers(): void {
  Electrobun.events.on("before-quit", () => {
    isQuitting = true;
    clearUpdateTimers();
    stopBackend();
  });

  Electrobun.events.on("close", (event: unknown) => {
    const closedId = (event as { data?: { id?: number } }).data?.id;
    if (mainWindow && closedId === mainWindow.id) {
      mainWindow = null;
    }
  });

  process.on("SIGINT", () => {
    if (isQuitting) return;
    isQuitting = true;
    clearUpdateTimers();
    stopBackend();
    Utils.quit();
  });

  process.on("SIGTERM", () => {
    if (isQuitting) return;
    isQuitting = true;
    clearUpdateTimers();
    stopBackend();
    Utils.quit();
  });
}

const desktopRuntimeInfo = resolveDesktopRuntimeInfo({
  platform: process.platform,
  processArch: process.arch,
  // Electrobun/Bun runs natively on the host architecture; there is no
  // Rosetta-style translation layer like Electron's runningUnderARM64Translation.
  runningUnderArm64Translation: false,
});

initializeLogging();

const autoUpdatesEnabled = await resolveAutoUpdateEnabled();
updateState = {
  ...createInitialDesktopUpdateState(desktopPackageJson.version, desktopRuntimeInfo, "latest"),
  enabled: autoUpdatesEnabled,
  status: autoUpdatesEnabled ? "idle" : "disabled",
};

configureApplicationMenu();
configureContextMenuListener();
registerLifecycleHandlers();
configureAutoUpdater();

void bootstrap().catch((error) => {
  console.error("[desktop] fatal startup error", error);
  stopBackend();
  Utils.quit();
});
