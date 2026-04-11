import { describe, expect, it } from "vitest";

import { deriveAgentControlState } from "./AgentControls.logic";

describe("deriveAgentControlState", () => {
  it("returns idle state for null session", () => {
    const state = deriveAgentControlState(null);
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(false);
    expect(state.statusLabel).toBe("Idle");
    expect(state.isRunning).toBe(false);
  });

  it("returns idle for idle status", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "idle",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(false);
    expect(state.statusLabel).toBe("Idle");
  });

  it("returns starting state", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "connecting",
      orchestrationStatus: "starting",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(true);
    expect(state.statusLabel).toBe("Starting");
    expect(state.statusVariant).toBe("info");
  });

  it("returns running with canPause when activeTurnId exists", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "running",
      activeTurnId: "turn-1" as never,
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(true);
    expect(state.canKill).toBe(true);
    expect(state.isRunning).toBe(true);
    expect(state.statusVariant).toBe("success");
  });

  it("returns running without canPause when no activeTurnId", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "running",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(true);
    expect(state.isRunning).toBe(true);
  });

  it("returns ready state", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "ready",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(true);
    expect(state.statusLabel).toBe("Ready");
  });

  it("returns interrupted state", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "interrupted",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(true);
    expect(state.statusLabel).toBe("Paused");
    expect(state.statusVariant).toBe("warning");
  });

  it("returns stopped state", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "closed",
      orchestrationStatus: "stopped",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(false);
    expect(state.statusLabel).toBe("Stopped");
  });

  it("returns error state", () => {
    const state = deriveAgentControlState({
      provider: "codex",
      status: "error",
      orchestrationStatus: "error",
      createdAt: "",
      updatedAt: "",
    });
    expect(state.canPause).toBe(false);
    expect(state.canKill).toBe(true);
    expect(state.statusLabel).toBe("Error");
    expect(state.statusVariant).toBe("error");
  });
});
