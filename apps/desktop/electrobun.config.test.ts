import { afterEach, describe, expect, it, vi } from "vitest";

const DEFAULT_UPDATE_BASE_URL = "https://github.com/opencoredev/beppo/releases/latest/download";

async function loadConfig() {
  vi.resetModules();
  return (await import("./electrobun.config.ts")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("electrobun.config", () => {
  it("always includes the Beppo release base URL when no override is set", async () => {
    vi.stubEnv("T3CODE_DESKTOP_UPDATE_BASE_URL", "");

    const config = await loadConfig();

    expect(config.app.name).toBe("Beppo");
    expect(config.release).toEqual({
      baseUrl: DEFAULT_UPDATE_BASE_URL,
    });
  });

  it("honors an explicit release base URL override", async () => {
    vi.stubEnv("T3CODE_DESKTOP_UPDATE_BASE_URL", "https://example.com/releases/download");

    const config = await loadConfig();

    expect(config.release).toEqual({
      baseUrl: "https://example.com/releases/download",
    });
  });
});
