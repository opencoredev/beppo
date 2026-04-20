import { describe, expect, it, vi } from "vitest";

import { pickFolderWithFeedback } from "./folderPicker";

describe("pickFolderWithFeedback", () => {
  it("reports unavailable bridge", async () => {
    const onError = vi.fn();

    await expect(
      pickFolderWithFeedback({
        api: null,
        onError,
      }),
    ).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith({
      title: "Folder picker unavailable",
      description: "The desktop bridge is not ready yet. Try again in a moment.",
    });
  });

  it("reports bridge failures", async () => {
    const onError = vi.fn();
    const api = {
      dialogs: {
        pickFolder: vi.fn().mockRejectedValue(new Error("boom")),
      },
    };

    await expect(pickFolderWithFeedback({ api, onError })).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith({
      title: "Could not open folder picker",
      description: "boom",
    });
  });

  it("returns the selected path without emitting an error", async () => {
    const onError = vi.fn();
    const api = {
      dialogs: {
        pickFolder: vi.fn().mockResolvedValue("/tmp/project"),
      },
    };

    await expect(pickFolderWithFeedback({ api, onError })).resolves.toBe("/tmp/project");
    expect(onError).not.toHaveBeenCalled();
  });

  it("treats a cancelled picker as a non-error", async () => {
    const onError = vi.fn();
    const api = {
      dialogs: {
        pickFolder: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(pickFolderWithFeedback({ api, onError })).resolves.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
