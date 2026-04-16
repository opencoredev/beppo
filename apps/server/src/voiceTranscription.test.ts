import { Buffer } from "node:buffer";

import type { ServerVoiceTranscriptionInput } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { transcribeVoiceWithChatGptSession } from "./voiceTranscription";

function createWavBase64(): string {
  const header = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0xc0, 0x5d, 0x00, 0x00, 0x80, 0xbb, 0x00, 0x00,
    0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x08, 0x00, 0x00,
  ]);
  const pcm = Buffer.alloc(2048);
  return Buffer.concat([header, pcm]).toString("base64");
}

function makeRequest(
  overrides: Partial<ServerVoiceTranscriptionInput> = {},
): ServerVoiceTranscriptionInput {
  return {
    provider: "codex",
    cwd: "/tmp/repo",
    audioBase64: createWavBase64(),
    mimeType: "audio/wav",
    sampleRateHz: 24_000,
    durationMs: 1_000,
    ...overrides,
  };
}

describe("transcribeVoiceWithChatGptSession", () => {
  it("returns transcription text on success", async () => {
    const resolveAuth = vi.fn().mockResolvedValue({ token: "token-1" });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "hello world" }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    await expect(
      transcribeVoiceWithChatGptSession({
        request: makeRequest(),
        resolveAuth,
        fetchImpl,
      }),
    ).resolves.toEqual({ text: "hello world" });

    expect(resolveAuth).toHaveBeenCalledWith(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes auth once after an expired token response", async () => {
    const resolveAuth = vi
      .fn()
      .mockResolvedValueOnce({ token: "token-1" })
      .mockResolvedValueOnce({ token: "token-2" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "expired" } }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transcript: "retry worked" }), { status: 200 }),
      ) as unknown as typeof fetch;

    await expect(
      transcribeVoiceWithChatGptSession({
        request: makeRequest(),
        resolveAuth,
        fetchImpl,
      }),
    ).resolves.toEqual({ text: "retry worked" });

    expect(resolveAuth).toHaveBeenNthCalledWith(1, false);
    expect(resolveAuth).toHaveBeenNthCalledWith(2, true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid WAV payloads before any network work", async () => {
    const resolveAuth = vi.fn();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      transcribeVoiceWithChatGptSession({
        request: makeRequest({
          audioBase64: Buffer.from("not-a-real-wav", "utf8").toString("base64"),
        }),
        resolveAuth,
        fetchImpl,
      }),
    ).rejects.toThrow("The recorded audio is not a valid WAV file.");

    expect(resolveAuth).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
