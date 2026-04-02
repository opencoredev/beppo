import type { OrchestrationThreadActivity, ThreadTokenUsageSnapshot } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

function buildSnapshot(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
  usedTokens: number,
): ContextWindowSnapshot {
  const maxTokens = asFiniteNumber(payload.maxTokens);
  const usedPercentage =
    maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
  const remainingTokens =
    maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
  const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

  return {
    usedTokens,
    totalProcessedTokens: asFiniteNumber(payload.totalProcessedTokens),
    maxTokens,
    remainingTokens,
    usedPercentage,
    remainingPercentage,
    inputTokens: asFiniteNumber(payload.inputTokens),
    cachedInputTokens: asFiniteNumber(payload.cachedInputTokens),
    outputTokens: asFiniteNumber(payload.outputTokens),
    reasoningOutputTokens: asFiniteNumber(payload.reasoningOutputTokens),
    lastUsedTokens: asFiniteNumber(payload.lastUsedTokens),
    lastInputTokens: asFiniteNumber(payload.lastInputTokens),
    lastCachedInputTokens: asFiniteNumber(payload.lastCachedInputTokens),
    lastOutputTokens: asFiniteNumber(payload.lastOutputTokens),
    lastReasoningOutputTokens: asFiniteNumber(payload.lastReasoningOutputTokens),
    toolUses: asFiniteNumber(payload.toolUses),
    durationMs: asFiniteNumber(payload.durationMs),
    compactsAutomatically: asBoolean(payload.compactsAutomatically) ?? false,
    updatedAt: activity.createdAt,
  };
}

/**
 * Derive the context window snapshot from thread activities.
 *
 * Instead of blindly picking the chronologically last "context-window.updated"
 * activity, we collect all such activities since the most recent compaction
 * boundary and pick the one with the **highest** `usedTokens`.  This prevents
 * the displayed counter from jumping downward when interleaved sub-task
 * progress events report smaller context snapshots than the main conversation.
 *
 * After a compaction event the counter legitimately drops, so we only consider
 * activities that came after the last compaction.
 */
export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  let bestActivity: OrchestrationThreadActivity | null = null;
  let bestPayload: Record<string, unknown> | null = null;
  let bestUsedTokens = 0;

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity) {
      continue;
    }

    // Stop at a compaction boundary -- everything before it reflects the
    // pre-compaction context and should be ignored.
    if (activity.kind === "context-compaction") {
      break;
    }

    if (activity.kind !== "context-window.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens <= 0) {
      continue;
    }

    // On the very first valid candidate, always accept it so that we never
    // return null when there is at least one valid activity.
    if (bestActivity === null || usedTokens > bestUsedTokens) {
      bestActivity = activity;
      bestPayload = payload;
      bestUsedTokens = usedTokens;
    }
  }

  if (bestActivity === null || bestPayload === null) {
    return null;
  }

  return buildSnapshot(bestActivity, bestPayload, bestUsedTokens);
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
