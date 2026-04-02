import * as OS from "node:os";
import { Effect, Path } from "effect";
import { APP_HIDDEN_DIR } from "@t3tools/shared/branding";
import { readPathFromLoginShell, resolveLoginShell } from "@t3tools/shared/shell";

export function fixPath(
  options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    readPath?: typeof readPathFromLoginShell;
  } = {},
): void {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") return;

  const env = options.env ?? process.env;

  try {
    const shell = resolveLoginShell(platform, env.SHELL);
    if (!shell) return;
    const result = (options.readPath ?? readPathFromLoginShell)(shell);
    if (result) {
      env.PATH = result;
    }
  } catch {
    // Silently ignore — keep default PATH
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
