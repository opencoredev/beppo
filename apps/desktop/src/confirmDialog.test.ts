import { beforeEach, describe, expect, it, vi } from "vitest";

const { showMessageBoxMock } = vi.hoisted(() => ({
  showMessageBoxMock: vi.fn(),
}));

vi.mock("./electrobun-runtime", () => ({
  Utils: {
    showMessageBox: showMessageBoxMock,
  },
}));

import { showDesktopConfirmDialog } from "./confirmDialog";

describe("showDesktopConfirmDialog", () => {
  beforeEach(() => {
    showMessageBoxMock.mockReset();
  });

  it("returns false and does not open a dialog for empty messages", async () => {
    const result = await showDesktopConfirmDialog("   ");

    expect(result).toBe(false);
    expect(showMessageBoxMock).not.toHaveBeenCalled();
  });

  it("returns true on confirm", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 });

    const result = await showDesktopConfirmDialog("Delete worktree?");

    expect(result).toBe(true);
    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["No", "Yes"],
        message: "Delete worktree?",
      }),
    );
  });

  it("returns false when the dialog is cancelled", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    const result = await showDesktopConfirmDialog("Delete worktree?");

    expect(result).toBe(false);
    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["No", "Yes"],
        message: "Delete worktree?",
      }),
    );
  });
});
