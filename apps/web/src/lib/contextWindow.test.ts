import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow";

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  overrides?: Partial<Pick<OrchestrationThreadActivity, "createdAt" | "turnId">>,
): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: overrides?.turnId ?? TurnId.makeUnsafe("turn-1"),
    createdAt: overrides?.createdAt ?? "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("picks the highest usedTokens to avoid jumpy sub-task values", () => {
    // Simulates: main task reports 42k, then sub-task reports 15k,
    // then main task reports 55k. The counter should show 55k (the highest).
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 42_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-2", "context-window.updated", {
        usedTokens: 15_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 55_000,
        maxTokens: 200_000,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(55_000);
  });

  it("does not jump down when a later activity has fewer tokens", () => {
    // Sub-task progress arrives after the main task's latest snapshot.
    // The counter should remain at the highest value (42k) instead of
    // dropping to the sub-task's 10k.
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 42_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-2", "context-window.updated", {
        usedTokens: 10_000,
        maxTokens: 200_000,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(42_000);
  });

  it("resets after a context compaction event", () => {
    // After compaction the context shrinks. The counter should reflect
    // the post-compaction value, ignoring the higher pre-compaction values.
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 180_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-2", "context-compaction", { state: "compacted" }),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 42_000,
        maxTokens: 200_000,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(42_000);
  });

  it("returns highest post-compaction value when multiple snapshots follow compaction", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 180_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-2", "context-compaction", { state: "compacted" }),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 30_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-4", "context-window.updated", {
        usedTokens: 45_000,
        maxTokens: 200_000,
      }),
      makeActivity("activity-5", "context-window.updated", {
        usedTokens: 20_000,
        maxTokens: 200_000,
      }),
    ]);

    // Should be 45k (highest after compaction), not 20k (latest) or 180k (pre-compaction)
    expect(snapshot?.usedTokens).toBe(45_000);
  });

  it("returns null when only compaction events exist after last compaction", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 100_000,
      }),
      makeActivity("activity-2", "context-compaction", { state: "compacted" }),
    ]);

    // No context-window.updated after compaction, so fall through.
    // The compaction boundary stops the search, returning null.
    expect(snapshot).toBeNull();
  });
});
