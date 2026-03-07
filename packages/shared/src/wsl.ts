import { execFileSync } from "node:child_process";

export const WSL_UNC_HOSTS = ["wsl.localhost", "wsl$"] as const;

export interface WslPath {
  readonly distro: string;
  readonly linuxPath: string;
  readonly uncPath: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/g, "");
}

function normalizeLinuxPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (trimmed === "") {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const segments = withLeadingSlash.split("/").filter((segment) => segment.length > 0);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function normalizeWindowsSegment(value: string): string {
  return value.replace(/[\\/]+/g, "\\").replace(/^\\+|\\+$/g, "");
}

export function toWslUncPath(input: {
  readonly distro: string;
  readonly linuxPath: string;
  readonly host?: (typeof WSL_UNC_HOSTS)[number];
}): string {
  const host = input.host ?? "wsl.localhost";
  const linuxPath = normalizeLinuxPath(input.linuxPath);
  const suffix = linuxPath === "/" ? "" : linuxPath.slice(1).replace(/\//g, "\\");
  return suffix.length === 0
    ? `\\\\${host}\\${input.distro}`
    : `\\\\${host}\\${input.distro}\\${suffix}`;
}

export function isWslUncPath(value: string): boolean {
  return /^\\\\wsl(?:\.localhost)?\\/i.test(value.trim());
}

export function parseWslPath(
  value: string,
  options: {
    readonly defaultDistro?: string | undefined;
  } = {},
): WslPath | null {
  const trimmed = trimTrailingSlashes(value.trim());
  if (trimmed.length === 0) {
    return null;
  }

  const uncMatch = trimmed.match(/^\\\\(wsl(?:\.localhost)?)\\([^\\/]+)(?:[\\/](.*))?$/i);
  if (uncMatch) {
    const distro = uncMatch[2]?.trim();
    if (!distro) {
      return null;
    }
    const rest = normalizeWindowsSegment(uncMatch[3] ?? "");
    const linuxPath = rest.length === 0 ? "/" : `/${rest.replace(/\\/g, "/")}`;
    return {
      distro,
      linuxPath: normalizeLinuxPath(linuxPath),
      uncPath: toWslUncPath({ distro, linuxPath }),
    };
  }

  if (trimmed.startsWith("/") && options.defaultDistro) {
    const linuxPath = normalizeLinuxPath(trimmed);
    return {
      distro: options.defaultDistro,
      linuxPath,
      uncPath: toWslUncPath({ distro: options.defaultDistro, linuxPath }),
    };
  }

  return null;
}

export function resolveDefaultWslDistroSync(): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const output = execFileSync("wsl.exe", ["-l", "-q"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 5_000,
    });
    const distro = output
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return distro ?? null;
  } catch {
    return null;
  }
}

export function resolveWslHomeDirectorySync(distro?: string): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  const resolvedDistro = distro ?? resolveDefaultWslDistroSync();
  if (!resolvedDistro) {
    return null;
  }

  try {
    const output = execFileSync(
      "wsl.exe",
      ["-d", resolvedDistro, "--exec", "sh", "-lc", "printf %s \"$HOME\""],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: 5_000,
      },
    ).trim();
    return output.length > 0 ? normalizeLinuxPath(output) : null;
  } catch {
    return null;
  }
}

export function resolveWindowsWslHomePathSync(distro?: string): string | null {
  const resolvedDistro = distro ?? resolveDefaultWslDistroSync();
  if (!resolvedDistro) {
    return null;
  }

  const homePath = resolveWslHomeDirectorySync(resolvedDistro);
  if (!homePath) {
    return null;
  }

  return toWslUncPath({ distro: resolvedDistro, linuxPath: homePath });
}
