import type {
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderSkill,
  ServerProviderSlashCommand,
  ServerProviderModel,
  ServerProviderRuntimeSupport,
  ServerProviderState,
} from "@t3tools/contracts";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { isWindowsCommandNotFound } from "../processRunner";

export const DEFAULT_TIMEOUT_MS = 4_000;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface ProviderProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
}

const STABLE_NATIVE_RUNTIME_SUPPORT: Partial<
  Record<ServerProvider["provider"], ServerProviderRuntimeSupport>
> = {
  codex: {
    transport: "native-cli",
    runtime: "stable",
    sessionStart: "stable",
    sendTurn: "stable",
    resumeSession: "stable",
    rollbackThread: "stable",
    sessionModelSwitch: "in-session",
  },
  claudeAgent: {
    transport: "native-cli",
    runtime: "stable",
    sessionStart: "stable",
    sendTurn: "stable",
    resumeSession: "stable",
    rollbackThread: "stable",
    sessionModelSwitch: "in-session",
  },
};

const EXPERIMENTAL_ACP_RUNTIME_SUPPORT: ServerProviderRuntimeSupport = {
  transport: "acp",
  runtime: "experimental",
  sessionStart: "unavailable",
  sendTurn: "unavailable",
  resumeSession: "unavailable",
  rollbackThread: "unavailable",
  sessionModelSwitch: "unsupported",
  notes: "ACP provider metadata is wired up, but Beppo runtime transport has not landed yet.",
};

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isCommandMissingCause(error: Error, commandName: string): boolean {
  const lower = error.message.toLowerCase();
  const name = commandName.toLowerCase();
  return (
    lower.includes(`command not found: ${name}`) ||
    lower.includes(`spawn ${name} enoent`) ||
    (lower.includes("not found") && lower.includes(name))
  );
}

export const spawnAndCollect = (binaryPath: string, command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    const result: CommandResult = { stdout, stderr, code: exitCode };
    if (isWindowsCommandNotFound(exitCode, stderr)) {
      return yield* Effect.fail(new Error(`spawn ${binaryPath} ENOENT`));
    }
    return result;
  }).pipe(Effect.scoped);

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  if (globalThis.Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseGenericCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  provider: ServerProvider["provider"],
  customModels: ReadonlyArray<string>,
  customModelCapabilities: ModelCapabilities,
): ReadonlyArray<ServerProviderModel> {
  const resolvedBuiltInModels = [...builtInModels];
  const seen = new Set(resolvedBuiltInModels.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  for (const candidate of customModels) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    customEntries.push({
      slug: normalized,
      name: normalized,
      isCustom: true,
      capabilities: customModelCapabilities,
    });
  }

  return [...resolvedBuiltInModels, ...customEntries];
}

export function buildServerProvider(input: {
  provider: ServerProvider["provider"];
  enabled: boolean;
  checkedAt: string;
  models: ReadonlyArray<ServerProviderModel>;
  slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  skills?: ReadonlyArray<ServerProviderSkill>;
  probe: ProviderProbeResult;
  experimental?: boolean;
  runtimeSupport?: ServerProviderRuntimeSupport;
  rateLimits?: unknown;
}): ServerProvider {
  return {
    provider: input.provider,
    enabled: input.enabled,
    installed: input.probe.installed,
    version: input.probe.version,
    status: input.enabled ? input.probe.status : "disabled",
    auth: input.probe.auth,
    checkedAt: input.checkedAt,
    ...(input.probe.message ? { message: input.probe.message } : {}),
    ...(input.experimental ? { experimental: true } : {}),
    ...((input.runtimeSupport ?? STABLE_NATIVE_RUNTIME_SUPPORT[input.provider]) !== undefined
      ? { runtimeSupport: input.runtimeSupport ?? STABLE_NATIVE_RUNTIME_SUPPORT[input.provider] }
      : {}),
    ...(input.rateLimits !== undefined ? { rateLimits: input.rateLimits } : {}),
    models: input.models,
    slashCommands: [...(input.slashCommands ?? [])],
    skills: [...(input.skills ?? [])],
  };
}

export function buildExperimentalAcpServerProvider(input: {
  provider: Extract<ServerProvider["provider"], "githubCopilot" | "cursor">;
  enabled: boolean;
  checkedAt: string;
  models: ReadonlyArray<ServerProviderModel>;
}): ServerProvider {
  return buildServerProvider({
    provider: input.provider,
    enabled: input.enabled,
    checkedAt: input.checkedAt,
    models: input.models,
    experimental: true,
    runtimeSupport: EXPERIMENTAL_ACP_RUNTIME_SUPPORT,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: input.enabled
        ? "Experimental ACP provider is enabled in settings, but session transport is not available yet."
        : "Experimental ACP provider scaffolding is available, but runtime transport is not enabled yet.",
    },
  });
}

export const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );
