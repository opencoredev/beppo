import { assert, describe, it } from "vitest";

import { matchesSidebarToggleShortcut } from "./sidebar";

function keyboardEvent(
  overrides: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    defaultPrevented: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "/",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("matchesSidebarToggleShortcut", () => {
  it("matches Ctrl+/", () => {
    assert.isTrue(matchesSidebarToggleShortcut(keyboardEvent({ ctrlKey: true }), "/"));
  });

  it("matches Cmd+/", () => {
    assert.isTrue(matchesSidebarToggleShortcut(keyboardEvent({ metaKey: true }), "/"));
  });

  it("matches Cmd+\\\\ for the right sidebar", () => {
    assert.isTrue(matchesSidebarToggleShortcut(keyboardEvent({ key: "\\", metaKey: true }), "\\"));
  });

  it("rejects events with extra modifiers", () => {
    assert.isFalse(
      matchesSidebarToggleShortcut(keyboardEvent({ ctrlKey: true, shiftKey: true }), "/"),
    );
    assert.isFalse(
      matchesSidebarToggleShortcut(keyboardEvent({ altKey: true, metaKey: true }), "/"),
    );
  });

  it("rejects events without exactly one mod key", () => {
    assert.isFalse(matchesSidebarToggleShortcut(keyboardEvent(), "/"));
    assert.isFalse(
      matchesSidebarToggleShortcut(keyboardEvent({ ctrlKey: true, metaKey: true }), "/"),
    );
  });
});
