import os from "node:os";

import { parseWslPath, resolveDefaultWslDistroSync, type WslPath } from "@t3tools/shared/wsl";

const WINDOWS_WSL_SPAWN_CWD = process.env.SystemRoot || os.homedir();

function defaultDistro(): string | undefined {
  return resolveDefaultWslDistroSync() ?? undefined;
}

export function resolveWslWorkspace(cwd: string): WslPath | null {
  if (process.platform !== "win32") {
    return null;
  }
  return parseWslPath(cwd, { defaultDistro: defaultDistro() });
}

export function toWindowsEditorPath(value: string): string {
  if (process.platform !== "win32") {
    return value;
  }
  return resolveWslWorkspace(value)?.uncPath ?? value;
}

function normalizeEnvValueForWsl(value: string, distro: string): string {
  return parseWslPath(value, { defaultDistro: distro })?.linuxPath ?? value;
}

function buildEnvOverrides(env: NodeJS.ProcessEnv | undefined, distro: string): string[] {
  if (!env) {
    return [];
  }

  const pairs: string[] = [];
  for (const [key, rawValue] of Object.entries(env)) {
    if (typeof rawValue !== "string") {
      continue;
    }
    if (process.env[key] === rawValue) {
      continue;
    }
    pairs.push(`${key}=${normalizeEnvValueForWsl(rawValue, distro)}`);
  }
  return pairs;
}

export interface WslProcessCommand {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly workspace: WslPath;
}

export function buildWslProcessCommand(input: {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}): WslProcessCommand | null {
  const workspace = resolveWslWorkspace(input.cwd);
  if (!workspace) {
    return null;
  }

  const envOverrides = buildEnvOverrides(input.env, workspace.distro);
  const args = ["-d", workspace.distro, "--cd", workspace.linuxPath, "--exec"];
  if (envOverrides.length > 0) {
    args.push("env", ...envOverrides);
  }
  args.push(input.command, ...(input.args ?? []));

  return {
    command: "wsl.exe",
    args,
    cwd: WINDOWS_WSL_SPAWN_CWD,
    env: process.env,
    workspace,
  };
}
