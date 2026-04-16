import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import readline from "node:readline";

import type {
  ServerVoiceTranscriptionInput,
  ServerVoiceTranscriptionResult,
} from "@t3tools/contracts";

import { buildCodexInitializeParams, killCodexChildProcess } from "./provider/codexAppServer";

const CHATGPT_TRANSCRIPTIONS_URL = "https://chatgpt.com/backend-api/transcribe";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_DURATION_MS = 120_000;
const AUTH_TIMEOUT_MS = 10_000;

interface JsonRpcProbeResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly message?: unknown;
  };
}

export interface ChatGptVoiceAuthContext {
  readonly token: string;
  readonly transcriptionUrl?: string;
}

export async function resolveCodexVoiceAuth(input: {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly homePath?: string;
  readonly refreshToken: boolean;
  readonly signal?: AbortSignal;
}): Promise<ChatGptVoiceAuthContext> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ["app-server"], {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.homePath ? { CODEX_HOME: input.homePath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const output = readline.createInterface({ input: child.stdout });

    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }
      completed = true;
      cleanup();
      callback();
    };

    const fail = (cause: unknown) =>
      finish(() =>
        reject(
          cause instanceof Error
            ? cause
            : new Error(`Voice transcription auth probe failed: ${String(cause)}.`),
        ),
      );

    const resolveOnce = (auth: ChatGptVoiceAuthContext) => finish(() => resolve(auth));

    const onAbort = () => {
      fail(new Error("Voice transcription auth probe aborted."));
    };

    const cleanup = () => {
      output.removeAllListeners();
      output.close();
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      if (!child.killed) {
        killCodexChildProcess(child);
      }
      input.signal?.removeEventListener("abort", onAbort);
      if (timeout) {
        clearTimeout(timeout);
      }
    };

    const writeMessage = (message: Record<string, unknown>) => {
      if (!child.stdin.writable) {
        fail(new Error("Cannot write to codex app-server stdin."));
        return;
      }

      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    };

    output.on("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        fail(new Error("Received invalid JSON from codex app-server during voice auth."));
        return;
      }

      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const response = parsed as JsonRpcProbeResponse;
      if (response.id === 1) {
        const errorMessage = readErrorMessage(response);
        if (errorMessage) {
          fail(new Error(`initialize failed: ${errorMessage}`));
          return;
        }

        writeMessage({ method: "initialized", params: {} });
        writeMessage({
          id: 2,
          method: "getAuthStatus",
          params: {
            includeToken: true,
            refreshToken: input.refreshToken,
          },
        });
        return;
      }

      if (response.id !== 2) {
        return;
      }

      const errorMessage = readErrorMessage(response);
      if (errorMessage) {
        fail(new Error(`getAuthStatus failed: ${errorMessage}`));
        return;
      }

      const result =
        response.result && typeof response.result === "object"
          ? (response.result as Record<string, unknown>)
          : undefined;
      const authMethod = readNonEmptyString(result?.authMethod);
      const token = readNonEmptyString(result?.authToken);
      if (authMethod !== "chatgpt" && authMethod !== "chatgptAuthTokens") {
        fail(new Error("Voice transcription requires a ChatGPT-authenticated Codex session."));
        return;
      }
      if (!token) {
        fail(new Error("No ChatGPT session token is available. Sign in to ChatGPT in Codex."));
        return;
      }

      resolveOnce({
        token,
        transcriptionUrl:
          readNonEmptyString(result?.transcriptionUrl) ?? CHATGPT_TRANSCRIPTIONS_URL,
      });
    });

    child.once("error", (cause) => {
      fail(new Error(`Could not start Codex auth discovery: ${readError(cause)}`));
    });
    child.once("exit", (code, signal) => {
      if (completed) {
        return;
      }
      fail(
        new Error(
          `codex app-server exited before voice auth completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
    });

    if (input.signal?.aborted) {
      onAbort();
      return;
    }
    input.signal?.addEventListener("abort", onAbort, { once: true });

    timeout = setTimeout(() => {
      fail(new Error("Timed out while reading ChatGPT auth from Codex."));
    }, AUTH_TIMEOUT_MS);
    timeout.unref?.();

    writeMessage({
      id: 1,
      method: "initialize",
      params: buildCodexInitializeParams(),
    });
  });
}

export async function transcribeVoiceWithChatGptSession(input: {
  readonly request: ServerVoiceTranscriptionInput;
  readonly resolveAuth: (refreshToken: boolean) => Promise<ChatGptVoiceAuthContext>;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<ServerVoiceTranscriptionResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Voice transcription is unavailable in this runtime.");
  }

  const audioBuffer = decodeVoiceAudio(input.request);
  let auth = await input.resolveAuth(false);
  let response = await requestTranscription({
    fetchImpl,
    audioBuffer,
    mimeType: input.request.mimeType,
    token: auth.token,
    ...(auth.transcriptionUrl ? { transcriptionUrl: auth.transcriptionUrl } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (response.status === 401 || response.status === 403) {
    auth = await input.resolveAuth(true);
    response = await requestTranscription({
      fetchImpl,
      audioBuffer,
      mimeType: input.request.mimeType,
      token: auth.token,
      ...(auth.transcriptionUrl ? { transcriptionUrl: auth.transcriptionUrl } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  if (!response.ok) {
    throw new Error(await readTranscriptionErrorMessage(response));
  }

  const payload = (await response.json().catch(() => null)) as {
    text?: unknown;
    transcript?: unknown;
  } | null;
  const text = readNonEmptyString(payload?.text) ?? readNonEmptyString(payload?.transcript);
  if (!text) {
    throw new Error("The transcription response did not include any text.");
  }

  return { text };
}

function decodeVoiceAudio(input: ServerVoiceTranscriptionInput): Buffer {
  if (input.mimeType !== "audio/wav") {
    throw new Error("Only WAV audio is supported for voice transcription.");
  }
  if (input.sampleRateHz !== 24_000) {
    throw new Error("Voice transcription requires 24 kHz mono WAV audio.");
  }
  if (input.durationMs <= 0) {
    throw new Error("Voice messages must include a positive duration.");
  }
  if (input.durationMs > MAX_DURATION_MS) {
    throw new Error("Voice messages are limited to 120 seconds.");
  }

  const normalizedBase64 = normalizeBase64(input.audioBase64);
  if (!normalizedBase64 || !isLikelyBase64(normalizedBase64)) {
    throw new Error("The recorded audio could not be decoded.");
  }

  const audioBuffer = Buffer.from(normalizedBase64, "base64");
  if (!audioBuffer.length || audioBuffer.toString("base64") !== normalizedBase64) {
    throw new Error("The recorded audio could not be decoded.");
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    throw new Error("Voice messages are limited to 10 MB.");
  }
  if (!isLikelyWavBuffer(audioBuffer)) {
    throw new Error("The recorded audio is not a valid WAV file.");
  }

  return audioBuffer;
}

async function requestTranscription(input: {
  readonly fetchImpl: typeof fetch;
  readonly audioBuffer: Buffer;
  readonly mimeType: string;
  readonly token: string;
  readonly transcriptionUrl?: string;
  readonly signal?: AbortSignal;
}): Promise<Response> {
  const formData = new FormData();
  formData.append("file", new Blob([input.audioBuffer], { type: input.mimeType }), "voice.wav");

  return input.fetchImpl(input.transcriptionUrl ?? CHATGPT_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
    body: formData,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

async function readTranscriptionErrorMessage(response: Response): Promise<string> {
  let errorMessage = `Transcription failed with status ${response.status}.`;
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
      message?: unknown;
    } | null;
    const providerMessage =
      readNonEmptyString(payload?.error?.message) ?? readNonEmptyString(payload?.message);
    if (providerMessage) {
      errorMessage = providerMessage;
    }
  } catch {
    // Keep the generic status-based message when the provider body is empty or invalid.
  }

  if (response.status === 401 || response.status === 403) {
    return "Your ChatGPT login has expired. Sign in to ChatGPT in Codex and try again.";
  }

  return errorMessage;
}

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === "string" ? response.error.message : undefined;
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBase64(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function isLikelyBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isLikelyWavBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}
