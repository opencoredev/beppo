import * as OS from "node:os";
import { Effect, Path } from "effect";
import { APP_HIDDEN_DIR } from "@t3tools/shared/branding";
import {
  listLoginShellCandidates,
  mergePathEntries,
  readPathFromLaunchctl,
  readPathFromLoginShell,
} from "@t3tools/shared/shell";

function logPathHydrationWarning(message: string, error?: unknown): void {
  console.warn(`[server] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readPath?: typeof readPathFromLoginShell;
    readLaunchctlPath?: typeof readPathFromLaunchctl;
    userShell?: string;
    logWarning?: (message: string, error?: unknown) => void;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const env = options.env ?? process.env;
  const logWarning = options.logWarning ?? logPathHydrationWarning;
  const readPath = options.readPath ?? readPathFromLoginShell;

  try {
    let shellPath: string | undefined;
    for (const shell of listLoginShellCandidates(platform, env.SHELL, options.userShell)) {
      try {
        shellPath = readPath(shell);
      } catch (error) {
        logWarning(`Failed to read PATH from login shell ${shell}.`, error);
      }

      if (shellPath) {
        break;
      }
    }

    const launchctlPath =
      platform === "darwin" && !shellPath
        ? (options.readLaunchctlPath ?? readPathFromLaunchctl)()
        : undefined;
    const mergedPath = mergePathEntries(shellPath ?? launchctlPath, env.PATH, platform);
    if (mergedPath) {
      env.PATH = mergedPath;
    }
  } catch (error) {
    logWarning("Failed to hydrate PATH from the user environment.", error);
  }
}

export const expandHomePath = Effect.fn(function* (input: string) {
  const { join } = yield* Path.Path;
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return join(OS.homedir(), input.slice(2));
  }
  return input;
});

export const resolveBaseDir = Effect.fn(function* (raw: string | undefined) {
  const { dirname, join, resolve } = yield* Path.Path;

  // Legacy: T3CODE_STATE_DIR pointed directly at the state directory.
  // The new T3CODE_HOME is its parent (state dir = T3CODE_HOME/userdata).
  // Honour the old variable when no explicit base dir is provided so users
  // with a custom T3CODE_STATE_DIR don't silently lose data.
  if (!raw || raw.trim().length === 0) {
    const legacyStateDir = process.env.T3CODE_STATE_DIR?.trim();
    if (legacyStateDir && legacyStateDir.length > 0) {
      yield* Effect.logWarning("T3CODE_STATE_DIR is deprecated. Use T3CODE_HOME instead.");
      const resolved = resolve(yield* expandHomePath(legacyStateDir));
      // Strip a trailing /userdata (or \userdata) segment so the derived
      // stateDir (baseDir + "/userdata") resolves back to the same location.
      const suffix = "/userdata";
      return resolved.endsWith(suffix) ? resolved.slice(0, -suffix.length) : dirname(resolved);
    }
    return join(OS.homedir(), APP_HIDDEN_DIR);
  }
  return resolve(yield* expandHomePath(raw.trim()));
});
