import * as OS from "node:os";
import type {
  ModelCapabilities,
  CodexSettings,
  ServerProvider,
  ServerProviderModel,
  ServerProviderAuth,
  ServerProviderSkill,
  ServerProviderState,
} from "@t3tools/contracts";
import {
  Cache,
  Duration,
  Effect,
  Equal,
  FileSystem,
  Layer,
  Option,
  Path,
  Result,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  buildPendingServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../codexCliVersion";
import {
  adjustCodexModelsForAccount,
  codexAuthSubLabel,
  codexAuthSubType,
  type CodexAccountSnapshot,
} from "../codexAccount";
import { probeCodexDiscovery } from "../codexAppServer";
import { CodexProvider } from "../Services/CodexProvider";
import { ServerSettingsService } from "../../serverSettings";
import { ServerSettingsError } from "@t3tools/contracts";
import { ensureNodePtySpawnHelperExecutable } from "../../terminal/Layers/NodePTY";
const DEFAULT_CODEX_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const PROVIDER = "codex" as const;
const OPENAI_AUTH_PROVIDERS = new Set(["openai"]);
const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
  {
    slug: "gpt-5.2",
    name: "GPT-5.2",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

export function getCodexModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_CODEX_MODEL_CAPABILITIES
  );
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return { attemptedJsonParse: false as const, auth: undefined as boolean | undefined };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", auth: { status: "authenticated" } };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", auth: { status: "authenticated" } };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    auth: { status: "unknown" },
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

export const readCodexConfigModelProvider = Effect.fn("readCodexConfigModelProvider")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsService = yield* ServerSettingsService;
  const codexHome = yield* settingsService.getSettings.pipe(
    Effect.map(
      (settings) =>
        settings.providers.codex.homePath ||
        process.env.CODEX_HOME ||
        path.join(OS.homedir(), ".codex"),
    ),
  );
  const configPath = path.join(codexHome, "config.toml");

  const content = yield* fileSystem
    .readFileString(configPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (content === undefined) {
    return undefined;
  }

  let inTopLevel = true;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const match = trimmed.match(/^model_provider\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return undefined;
});

export const hasCustomModelProvider = readCodexConfigModelProvider().pipe(
  Effect.map((provider) => provider !== undefined && !OPENAI_AUTH_PROVIDERS.has(provider)),
  Effect.orElseSucceed(() => false),
);

const CAPABILITIES_PROBE_TIMEOUT_MS = 8_000;
const CODEX_STATUS_PROBE_TIMEOUT_MS = 8_000;
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-9;?]*[A-Za-z]`, "g");

class CodexStatusProbeError extends Schema.TaggedErrorClass<CodexStatusProbeError>()(
  "CodexStatusProbeError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

function parseCodexStatusResetAt(raw: string | undefined, now = new Date()): string | undefined {
  const text = raw?.trim();
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/^resets?\s+/i, "").trim();
  const timeAndDate = normalized.match(
    /^(\d{1,2}:\d{2}) on (\d{1,2} [A-Za-z]{3}|[A-Za-z]{3} \d{1,2})$/,
  );
  if (timeAndDate) {
    const [, time, datePart] = timeAndDate;
    const candidate = new Date(`${datePart} ${now.getFullYear()} ${time}`);
    if (!Number.isNaN(candidate.getTime())) {
      if (candidate.getTime() < now.getTime()) {
        candidate.setFullYear(candidate.getFullYear() + 1);
      }
      return candidate.toISOString();
    }
  }

  const timeOnly = normalized.match(/^(\d{1,2}:\d{2})$/);
  if (timeOnly) {
    const [hoursText, minutesText] = timeOnly[1]!.split(":");
    const candidate = new Date(now);
    candidate.setSeconds(0, 0);
    candidate.setHours(Number(hoursText), Number(minutesText), 0, 0);
    if (candidate.getTime() < now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  return undefined;
}

function parseCodexStatusRateLimits(text: string): Record<string, unknown> | undefined {
  const clean = text.replace(ANSI_ESCAPE_PATTERN, "");
  const fiveHourMatch = clean.match(
    /(?:5h|5-hour) limit:[^\n]*?(\d{1,3})%\s+left(?:\s*\((?:resets?\s+)?([^)]+)\))?/i,
  );
  const weeklyMatch = clean.match(
    /Weekly limit:[^\n]*?(\d{1,3})%\s+left(?:\s*\((?:resets?\s+)?([^)]+)\))?/i,
  );

  const toEntry = (
    remainingPercentText: string | undefined,
    windowDurationMins: number,
    resetText: string | undefined,
  ) => {
    if (!remainingPercentText) {
      return undefined;
    }
    const remainingPercent = Number.parseInt(remainingPercentText, 10);
    if (!Number.isFinite(remainingPercent)) {
      return undefined;
    }
    const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent));
    const resetAt = parseCodexStatusResetAt(resetText);
    return {
      usedPercent,
      windowDurationMins,
      ...(resetAt ? { resetAt } : {}),
    };
  };

  const primary = toEntry(fiveHourMatch?.[1], 300, fiveHourMatch?.[2]);
  const secondary = toEntry(weeklyMatch?.[1], 10_080, weeklyMatch?.[2]);
  if (!primary && !secondary) {
    return undefined;
  }

  return {
    rateLimits: {
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    },
  };
}

async function _captureCodexStatusWithPtyDeprecated(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}): Promise<string> {
  return captureCodexStatusWithPty(input);
}
/*
  const env = {
    ...process.env,
    ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
  };
  const markers = ["5h limit", "5-hour limit", "Weekly limit", "Credits:"];
  const cursorQuery = "\u001b[6n";
  const cursorResponse = "\u001b[1;1R";
  const start = Date.now();

  if (typeof Bun !== "undefined" && process.platform !== "win32") {
    const decoder = new TextDecoder();
    return await new Promise<string>((resolve, reject) => {
      let output = "";
      let sentStatus = false;
      let settled = false;
      let markerSeenAt: number | null = null;
      let statusSentAt: number | null = null;
      let enterRetries = 0;
      let resendRetries = 0;
      const subprocess = Bun.spawn([input.binaryPath, "-s", "read-only", "-a", "untrusted"], {
        cwd: process.cwd(),
        env,
        terminal: {
          cols: 200,
          rows: 60,
          data(_terminal, data) {
            const text = decoder.decode(data, { stream: true });
            output += text;
            if (output.includes(cursorQuery)) {
              subprocess.terminal?.write(cursorResponse);
            }
            if (markers.some((marker) => output.includes(marker)) && markerSeenAt === null) {
              markerSeenAt = Date.now();
            }
          },
        },
      });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try {
          subprocess.kill();
        } catch {}
        fn();
      };

      const tick = setInterval(() => {
        if (!sentStatus && Date.now() - start >= 300) {
          subprocess.terminal?.write("/status\n");
          sentStatus = true;
          statusSentAt = Date.now();
        }

        if (markerSeenAt !== null && Date.now() - markerSeenAt >= 600) {
          clearInterval(tick);
          finish(() => resolve(output));
          return;
        }

        if (sentStatus && markerSeenAt === null && statusSentAt !== null) {
          if (Date.now() - statusSentAt >= 1_000 && enterRetries < 2) {
            subprocess.terminal?.write("\r");
            enterRetries += 1;
            return;
          }

          if (Date.now() - statusSentAt >= 2_500 && resendRetries < 1) {
            subprocess.terminal?.write("/status\n");
            resendRetries += 1;
            statusSentAt = Date.now();
            enterRetries = 0;
            return;
          }
        }

        if (Date.now() - start >= CODEX_STATUS_PROBE_TIMEOUT_MS) {
          clearInterval(tick);
          finish(() => reject(new Error("Codex status probe timed out.")));
        }
      }, 100);

      void subprocess.exited.then(() => {
        if (!settled && markers.some((marker) => output.includes(marker))) {
          clearInterval(tick);
          finish(() => resolve(output));
        }
      });
    });
  }

  const nodePty = await import("node-pty");
  return await new Promise<string>((resolve, reject) => {
    let output = "";
    let sentStatus = false;
    let settled = false;
    let markerSeenAt: number | null = null;
    let statusSentAt: number | null = null;
    let enterRetries = 0;
    let resendRetries = 0;
    const ptyProcess = nodePty.spawn(input.binaryPath, ["-s", "read-only", "-a", "untrusted"], {
      cwd: process.cwd(),
      cols: 200,
      rows: 60,
      env,
      name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
    });

    const cleanup = () => {
      if (settled) return;
      settled = true;
      try {
        ptyProcess.kill();
      } catch {}
    };

    const unsubscribeData = ptyProcess.onData((data) => {
      output += data;
      if (output.includes(cursorQuery)) {
        ptyProcess.write(cursorResponse);
      }
      if (markers.some((marker) => output.includes(marker)) && markerSeenAt === null) {
        markerSeenAt = Date.now();
      }
    });

    const unsubscribeExit = ptyProcess.onExit(() => {
      if (!settled && markers.some((marker) => output.includes(marker))) {
        clearInterval(tick);
        cleanup();
        unsubscribeData.dispose?.();
        unsubscribeExit.dispose?.();
        resolve(output);
      }
    });

    const tick = setInterval(() => {
      if (!sentStatus && Date.now() - start >= 300) {
        ptyProcess.write("/status\n");
        sentStatus = true;
        statusSentAt = Date.now();
      }

      if (markerSeenAt !== null && Date.now() - markerSeenAt >= 600) {
        clearInterval(tick);
        cleanup();
        unsubscribeData.dispose?.();
        unsubscribeExit.dispose?.();
        resolve(output);
        return;
      }

      if (sentStatus && markerSeenAt === null && statusSentAt !== null) {
        if (Date.now() - statusSentAt >= 1_000 && enterRetries < 2) {
          ptyProcess.write("\r");
          enterRetries += 1;
          return;
        }

        if (Date.now() - statusSentAt >= 2_500 && resendRetries < 1) {
          ptyProcess.write("/status\n");
          resendRetries += 1;
          statusSentAt = Date.now();
          enterRetries = 0;
          return;
        }
      }

      if (Date.now() - start >= CODEX_STATUS_PROBE_TIMEOUT_MS) {
        clearInterval(tick);
        cleanup();
        unsubscribeData.dispose?.();
        unsubscribeExit.dispose?.();
        reject(new Error("Codex status probe timed out."));
    const resetAt = parseCodexStatusResetAt(resetText);
    return {
      usedPercent,
      windowDurationMins,
      ...(resetAt ? { resetAt } : {}),
    };
  };

  const primary = toEntry(fiveHourMatch?.[1], 300, fiveHourMatch?.[2]);
  const secondary = toEntry(weeklyMatch?.[1], 10_080, weeklyMatch?.[2]);
  if (!primary && !secondary) {
    return undefined;
  }

  return {
    rateLimits: {
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    },
  };
}

*/

async function captureCodexStatusWithPty(input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}): Promise<string> {
  const env = {
    ...process.env,
    ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
  };
  const markers = ["5h limit", "5-hour limit", "Weekly limit", "Credits:"];
  const cursorQuery = "\u001b[6n";
  const cursorResponse = "\u001b[1;1R";
  const start = Date.now();

  if (typeof Bun !== "undefined" && process.platform !== "win32") {
    const decoder = new TextDecoder();
    return await new Promise<string>((resolve, reject) => {
      let output = "";
      let sentStatus = false;
      let settled = false;
      let markerSeenAt: number | null = null;
      let statusSentAt: number | null = null;
      let enterRetries = 0;
      let resendRetries = 0;
      const subprocess = Bun.spawn([input.binaryPath, "-s", "read-only", "-a", "untrusted"], {
        cwd: process.cwd(),
        env,
        terminal: {
          cols: 200,
          rows: 60,
          data(_terminal, data) {
            const text = decoder.decode(data, { stream: true });
            output += text;
            if (output.includes(cursorQuery)) {
              subprocess.terminal?.write(cursorResponse);
            }
            if (markers.some((marker) => output.includes(marker)) && markerSeenAt === null) {
              markerSeenAt = Date.now();
            }
          },
        },
      });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        try {
          subprocess.kill();
        } catch {}
        fn();
      };

      const tick = setInterval(() => {
        if (!sentStatus && Date.now() - start >= 300) {
          subprocess.terminal?.write("/status\n");
          sentStatus = true;
          statusSentAt = Date.now();
        }

        if (markerSeenAt !== null && Date.now() - markerSeenAt >= 600) {
          clearInterval(tick);
          finish(() => resolve(output));
          return;
        }

        if (sentStatus && markerSeenAt === null && statusSentAt !== null) {
          if (Date.now() - statusSentAt >= 1_000 && enterRetries < 2) {
            subprocess.terminal?.write("\r");
            enterRetries += 1;
            return;
          }

          if (Date.now() - statusSentAt >= 2_500 && resendRetries < 1) {
            subprocess.terminal?.write("/status\n");
            resendRetries += 1;
            statusSentAt = Date.now();
            enterRetries = 0;
            return;
          }
        }

        if (Date.now() - start >= CODEX_STATUS_PROBE_TIMEOUT_MS) {
          clearInterval(tick);
          finish(() => reject(new Error("Codex status probe timed out.")));
        }
      }, 100);

      void subprocess.exited.then(() => {
        if (settled) {
          return;
        }
        clearInterval(tick);
        finish(() => {
          if (markers.some((marker) => output.includes(marker))) {
            resolve(output);
            return;
          }
          reject(new Error("Codex process exited before producing status output."));
        });
      });
    });
  }

  const nodePty = await import("node-pty");
  return await new Promise<string>((resolve, reject) => {
    let output = "";
    let sentStatus = false;
    let settled = false;
    let markerSeenAt: number | null = null;
    let statusSentAt: number | null = null;
    let enterRetries = 0;
    let resendRetries = 0;
    let tick: ReturnType<typeof setInterval> | null = null;
    const ptyProcess = nodePty.spawn(input.binaryPath, ["-s", "read-only", "-a", "untrusted"], {
      cwd: process.cwd(),
      cols: 200,
      rows: 60,
      env,
      name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
    });

    const safeWrite = (value: string) => {
      try {
        ptyProcess.write(value);
      } catch {}
    };

    let unsubscribeExit: { dispose?: () => void } | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (tick !== null) {
        clearInterval(tick);
      }
      unsubscribeData.dispose?.();
      unsubscribeExit?.dispose?.();
      try {
        ptyProcess.kill();
      } catch {}
      fn();
    };

    const unsubscribeData = ptyProcess.onData((data) => {
      output += data;
      if (output.includes(cursorQuery)) {
        safeWrite(cursorResponse);
      }
      if (markers.some((marker) => output.includes(marker)) && markerSeenAt === null) {
        markerSeenAt = Date.now();
      }
    });

    unsubscribeExit = ptyProcess.onExit(() => {
      if (settled) {
        return;
      }
      finish(() => {
        if (markers.some((marker) => output.includes(marker))) {
          resolve(output);
          return;
        }
        reject(new Error("Codex process exited before producing status output."));
      });
    });

    tick = setInterval(() => {
      if (!sentStatus && Date.now() - start >= 300) {
        safeWrite("/status\n");
        sentStatus = true;
        statusSentAt = Date.now();
      }

      if (markerSeenAt !== null && Date.now() - markerSeenAt >= 600) {
        finish(() => resolve(output));
        return;
      }

      if (sentStatus && markerSeenAt === null && statusSentAt !== null) {
        if (Date.now() - statusSentAt >= 1_000 && enterRetries < 2) {
          safeWrite("\r");
          enterRetries += 1;
          return;
        }

        if (Date.now() - statusSentAt >= 2_500 && resendRetries < 1) {
          safeWrite("/status\n");
          resendRetries += 1;
          statusSentAt = Date.now();
          enterRetries = 0;
          return;
        }
      }

      if (Date.now() - start >= CODEX_STATUS_PROBE_TIMEOUT_MS) {
        finish(() => reject(new Error("Codex status probe timed out.")));
      }
    }, 100);
  });
}

const probeCodexRateLimits = Effect.fn("probeCodexRateLimits")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
}) {
  if (typeof Bun === "undefined") {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* ensureNodePtySpawnHelperExecutable().pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.orElseSucceed(() => undefined),
    );
  }

  const result = yield* Effect.tryPromise({
    try: () => captureCodexStatusWithPty(input),
    catch: (cause) =>
      new CodexStatusProbeError({
        detail:
          cause instanceof Error ? cause.message : `Codex status probe failed: ${String(cause)}`,
        cause,
      }),
  }).pipe(Effect.option);

  if (Option.isNone(result)) {
    return undefined;
  }

  return parseCodexStatusRateLimits(result.value);
});

const probeCodexCapabilities = (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly cwd: string;
}) =>
  Effect.tryPromise((signal) => probeCodexDiscovery({ ...input, signal })).pipe(
    Effect.timeoutOption(CAPABILITIES_PROBE_TIMEOUT_MS),
    Effect.result,
    Effect.map((result) => {
      if (Result.isFailure(result)) return undefined;
      return Option.isSome(result.success) ? result.success.value : undefined;
    }),
  );

const runCodexCommand = Effect.fn("runCodexCommand")(function* (args: ReadonlyArray<string>) {
  const settingsService = yield* ServerSettingsService;
  const codexSettings = yield* settingsService.getSettings.pipe(
    Effect.map((settings) => settings.providers.codex),
  );
  const command = ChildProcess.make(codexSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ...(codexSettings.homePath ? { CODEX_HOME: codexSettings.homePath } : {}),
    },
  });
  return yield* spawnAndCollect(codexSettings.binaryPath, command);
});

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  resolveAccount?: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
  }) => Effect.Effect<CodexAccountSnapshot | undefined>,
  resolveSkills?: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly cwd: string;
  }) => Effect.Effect<ReadonlyArray<ServerProviderSkill> | undefined>,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ServerSettingsService
> {
  const codexSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.codex),
  );
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    codexSettings.customModels,
    DEFAULT_CODEX_MODEL_CAPABILITIES,
  );

  if (!codexSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in Beppo settings.",
      },
    });
  }

  const versionProbe = yield* runCodexCommand(["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error, codexSettings.binaryPath),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error, codexSettings.binaryPath)
          ? "Codex CLI (`codex`) is not installed or not on PATH."
          : `Failed to execute Codex CLI health check: ${error.message}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Codex CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion =
    parseCodexCliVersion(`${version.stdout}\n${version.stderr}`) ??
    parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Codex CLI is installed but failed to run. ${detail}`
          : "Codex CLI is installed but failed to run.",
      },
    });
  }

  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: formatCodexCliUpgradeMessage(parsedVersion),
      },
    });
  }

  const skills =
    (resolveSkills
      ? yield* resolveSkills({
          binaryPath: codexSettings.binaryPath,
          homePath: codexSettings.homePath,
          cwd: process.cwd(),
        }).pipe(Effect.orElseSucceed(() => undefined))
      : undefined) ?? [];

  if (yield* hasCustomModelProvider) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models,
      skills,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "ready",
        auth: { status: "unknown" },
        message: "Using a custom Codex model provider; OpenAI login check skipped.",
      },
    });
  }

  const authProbe = yield* runCodexCommand(["login", "status"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );
  const account = resolveAccount
    ? yield* resolveAccount({
        binaryPath: codexSettings.binaryPath,
        homePath: codexSettings.homePath,
      })
    : undefined;
  const resolvedModels = adjustCodexModelsForAccount(models, account);

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      skills,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: `Could not verify Codex authentication status: ${error.message}.`,
      },
    });
  }

  if (Option.isNone(authProbe.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: codexSettings.enabled,
      checkedAt,
      models: resolvedModels,
      skills,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Codex authentication status. Timed out while running command.",
      },
    });
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  const authType = codexAuthSubType(account);
  const authLabel = codexAuthSubLabel(account);
  const rateLimits =
    parsed.auth.status === "authenticated"
      ? yield* probeCodexRateLimits({
          binaryPath: codexSettings.binaryPath,
          ...(codexSettings.homePath ? { homePath: codexSettings.homePath } : {}),
        })
      : undefined;
  return buildServerProvider({
    provider: PROVIDER,
    enabled: codexSettings.enabled,
    checkedAt,
    models: resolvedModels,
    skills,
    probe: {
      installed: true,
      version: parsedVersion,
      status: parsed.status,
      auth: {
        ...parsed.auth,
        ...(authType ? { type: authType } : {}),
        ...(authLabel ? { label: authLabel } : {}),
      },
      ...(parsed.message ? { message: parsed.message } : {}),
    },
    ...(rateLimits ? { rateLimits } : {}),
  });
});

const makePendingCodexProvider = (codexSettings: CodexSettings): ServerProvider => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    codexSettings.customModels,
    DEFAULT_CODEX_MODEL_CAPABILITIES,
  );

  return buildPendingServerProvider({
    provider: PROVIDER,
    enabled: codexSettings.enabled,
    checkedAt,
    models,
    disabledMessage: "Codex is disabled in Beppo settings.",
    checkingMessage: "Checking Codex status…",
  });
};

export const CodexProviderLive = Layer.effect(
  CodexProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const accountProbeCache = yield* Cache.make({
      capacity: 4,
      timeToLive: Duration.minutes(5),
      lookup: (key: string) => {
        const [binaryPath, homePath, cwd] = JSON.parse(key) as [string, string | undefined, string];
        return probeCodexCapabilities({
          binaryPath,
          cwd,
          ...(homePath ? { homePath } : {}),
        });
      },
    });

    const getDiscovery = (input: {
      readonly binaryPath: string;
      readonly homePath?: string;
      readonly cwd: string;
    }) =>
      Cache.get(accountProbeCache, JSON.stringify([input.binaryPath, input.homePath, input.cwd]));

    const checkProvider = checkCodexProviderStatus(
      (input) =>
        getDiscovery({
          ...input,
          cwd: process.cwd(),
        }).pipe(Effect.map((discovery) => discovery?.account)),
      (input) => getDiscovery(input).pipe(Effect.map((discovery) => discovery?.skills)),
    ).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CodexSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.codex),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.codex),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      buildInitialSnapshot: makePendingCodexProvider,
      checkProvider,
    });
  }),
);
