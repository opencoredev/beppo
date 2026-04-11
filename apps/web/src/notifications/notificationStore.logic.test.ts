import { describe, expect, it } from "vitest";

import { formatNotificationBody, isStuck, shouldNotify } from "./notificationStore.logic";

describe("isStuck", () => {
  it("returns false when within threshold", () => {
    const now = new Date("2024-01-01T00:02:00Z");
    expect(isStuck("2024-01-01T00:00:00Z", now)).toBe(false);
  });

  it("returns true when beyond threshold", () => {
    const now = new Date("2024-01-01T00:04:00Z");
    expect(isStuck("2024-01-01T00:00:00Z", now)).toBe(true);
  });

  it("respects custom threshold", () => {
    const now = new Date("2024-01-01T00:01:00Z");
    expect(isStuck("2024-01-01T00:00:00Z", now, 30_000)).toBe(true);
  });

  it("returns false for invalid date", () => {
    const now = new Date("2024-01-01T00:04:00Z");
    expect(isStuck("invalid-date", now)).toBe(false);
  });
});

describe("shouldNotify", () => {
  it("returns nothing when disabled", () => {
    const result = shouldNotify({
      type: "error",
      enabled: false,
      permission: "granted",
      documentHasFocus: false,
    });
    expect(result.native).toBe(false);
    expect(result.toast).toBe(false);
  });

  it("returns native when granted and not focused", () => {
    const result = shouldNotify({
      type: "error",
      enabled: true,
      permission: "granted",
      documentHasFocus: false,
    });
    expect(result.native).toBe(true);
    expect(result.toast).toBe(false);
  });

  it("returns toast when focused even if granted", () => {
    const result = shouldNotify({
      type: "error",
      enabled: true,
      permission: "granted",
      documentHasFocus: true,
    });
    expect(result.native).toBe(false);
    expect(result.toast).toBe(true);
  });

  it("returns toast when permission denied", () => {
    const result = shouldNotify({
      type: "error",
      enabled: true,
      permission: "denied",
      documentHasFocus: false,
    });
    expect(result.native).toBe(false);
    expect(result.toast).toBe(true);
  });

  it("returns toast when permission unsupported", () => {
    const result = shouldNotify({
      type: "stuck",
      enabled: true,
      permission: "unsupported",
      documentHasFocus: false,
    });
    expect(result.native).toBe(false);
    expect(result.toast).toBe(true);
  });
});

describe("formatNotificationBody", () => {
  it("formats needs-input notification", () => {
    const content = formatNotificationBody("needs-input");
    expect(content.title).toBe("Agent needs your input");
    expect(content.body).toContain("approval");
  });

  it("formats stuck notification", () => {
    const content = formatNotificationBody("stuck");
    expect(content.title).toBe("Agent might be stuck");
  });

  it("formats error notification", () => {
    const content = formatNotificationBody("error", "Build failed");
    expect(content.title).toBe("Agent error");
    expect(content.body).toBe("Build failed");
  });

  it("formats completed notification", () => {
    const content = formatNotificationBody("completed", "Fix auth flow");
    expect(content.title).toBe("Agent finished");
    expect(content.body).toBe('"Fix auth flow" completed.');
  });

  it("uses detail when provided", () => {
    const content = formatNotificationBody("needs-input", "Custom message");
    expect(content.body).toBe("Custom message");
  });
});
