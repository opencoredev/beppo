import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestActivityRateLimitSnapshot,
  deriveLatestProviderRateLimitSnapshots,
  deriveVisibleRateLimitRows,
  formatRateLimitValue,
} from "./rateLimits";

function makeActivity(
  id: string,
  payload: unknown,
  createdAt = "2099-04-08T18:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: id as EventId,
    tone: "info",
    kind: "account.rate-limits.updated",
    summary: "rate limits",
    payload,
    turnId: "turn-1" as TurnId,
    createdAt,
  };
}

describe("rateLimits helpers", () => {
  it("reads direct remaining/limit snapshots", () => {
    const snapshot = deriveLatestActivityRateLimitSnapshot([
      makeActivity("activity-1", {
        primary: {
          remaining: 12,
          limit: 15,
          resetAt: "2099-04-08T20:43:00.000Z",
        },
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(deriveVisibleRateLimitRows(snapshot?.entries ?? [])).toEqual([
      {
        id: "5h",
        label: "5h",
        remaining: 12,
        limit: 15,
        remainingPercent: 80,
        resetAt: "2099-04-08T20:43:00.000Z",
        windowDurationMins: null,
      },
    ]);
  });

  it("normalizes codex-style 5h and weekly payloads", () => {
    const snapshot = deriveLatestActivityRateLimitSnapshot([
      makeActivity("activity-1", {
        rateLimits: {
          rateLimits: {
            primary: {
              usedPercent: 12,
              windowDurationMins: 300,
              resetsAt: 4_079_388_780,
            },
            secondary: {
              usedPercent: 8,
              windowDurationMins: 10_080,
              resetsAt: 4_079_880_000,
            },
          },
        },
      }),
    ]);

    expect(deriveVisibleRateLimitRows(snapshot?.entries ?? [])).toEqual([
      {
        id: "5h",
        label: "5h",
        remaining: null,
        limit: null,
        remainingPercent: 88,
        resetAt: "2099-04-09T03:33:00.000Z",
        windowDurationMins: 300,
      },
      {
        id: "weekly",
        label: "Weekly",
        remaining: null,
        limit: null,
        remainingPercent: 92,
        resetAt: "2099-04-14T20:00:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
  });

  it("normalizes claude runtime utilization payloads", () => {
    const snapshot = deriveLatestActivityRateLimitSnapshot([
      makeActivity("activity-1", {
        rate_limit_info: {
          rateLimitType: "five_hour",
          utilization: 0.9,
          resetsAt: 4_078_972_980,
        },
      }),
    ]);

    expect(deriveVisibleRateLimitRows(snapshot?.entries ?? [])).toEqual([
      {
        id: "5h",
        label: "5h",
        remaining: null,
        limit: null,
        remainingPercent: 10,
        resetAt: "2099-04-04T08:03:00.000Z",
        windowDurationMins: null,
      },
    ]);
  });

  it("keeps the latest snapshot per provider across threads", () => {
    const snapshots = deriveLatestProviderRateLimitSnapshots([
      {
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        session: null,
        activities: [
          makeActivity(
            "activity-1",
            {
              rateLimits: {
                primary: {
                  usedPercent: 20,
                  windowDurationMins: 300,
                },
              },
            },
            "2099-04-08T18:00:00.000Z",
          ),
        ],
      },
      {
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        session: null,
        activities: [
          makeActivity(
            "activity-2",
            {
              rateLimits: {
                primary: {
                  usedPercent: 10,
                  windowDurationMins: 300,
                },
              },
            },
            "2099-04-08T19:00:00.000Z",
          ),
        ],
      },
      {
        modelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        session: null,
        activities: [
          makeActivity("activity-3", {
            rate_limit_info: {
              rateLimitType: "weekly",
              utilization: 0.2,
            },
          }),
        ],
      },
    ]);

    expect(
      formatRateLimitValue(
        snapshots.get("codex")?.entries[0] ?? {
          remaining: null,
          limit: null,
          remainingPercent: null,
        },
      ),
    ).toBe("90%");
    expect(
      formatRateLimitValue(
        snapshots.get("claudeAgent")?.entries[0] ?? {
          remaining: null,
          limit: null,
          remainingPercent: null,
        },
      ),
    ).toBe("80%");
  });
});
