import { describe, expect, it } from "vitest";

import { createStartupRedirectWindowUrl } from "./startupWindow";

const DATA_URL_PREFIX = "data:text/html;charset=utf-8,";

function decodeStartupWindowUrl(url: string): string {
  expect(url.startsWith(DATA_URL_PREFIX)).toBe(true);
  return decodeURIComponent(url.slice(DATA_URL_PREFIX.length));
}

describe("createStartupRedirectWindowUrl", () => {
  it("builds a splash page that redirects once the backend websocket is available", () => {
    const targetUrl = "http://127.0.0.1:4100/?ws=token";
    const backendWsUrl = "ws://127.0.0.1:4100/?token=abc123";

    const url = createStartupRedirectWindowUrl(targetUrl, backendWsUrl);
    const html = decodeStartupWindowUrl(url);

    expect(html).toContain("Starting Beppo");
    expect(html).toContain("Waiting for the local server to respond");
    expect(html).toContain("This should only take a moment.");
    expect(html).toContain("color-scheme: dark;");
    expect(html).toContain(`const targetUrl = ${JSON.stringify(targetUrl)};`);
    expect(html).toContain(`const backendWsUrl = ${JSON.stringify(backendWsUrl)};`);
    expect(html).toContain("const timeoutMs = 15000;");
    expect(html).toContain("new WebSocket(backendWsUrl)");
    expect(html).toContain("window.location.replace(targetUrl)");
    expect(html).toContain("Beppo is taking longer than expected to start.");
  });
});
