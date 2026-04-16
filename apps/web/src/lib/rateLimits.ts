import type { OrchestrationThreadActivity, ProviderKind } from "@t3tools/contracts";

import type { Thread } from "../types";

export interface RateLimitEntry {
  readonly label: string;
  readonly remaining: number | null;
  readonly limit: number | null;
  readonly remainingPercent: number | null;
  readonly resetAt: string | null;
  readonly windowDurationMins: number | null;
}

export interface ActivityRateLimitSnapshot {
  readonly entries: ReadonlyArray<RateLimitEntry>;
  readonly updatedAt: string;
}

export interface ProviderRateLimitSnapshot extends ActivityRateLimitSnapshot {
  readonly provider: ProviderKind;
}

export interface RateLimitRow extends RateLimitEntry {
  readonly id: string;
}

type ThreadRateLimitSource = Pick<Thread, "activities" | "modelSelection" | "session">;

const WINDOW_PRIORITY = new Map<string, number>([
  ["5h", 0],
  ["Weekly", 1],
  ["Current", 2],
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function resolveRemainingPercent(input: {
  remaining: number | null;
  limit: number | null;
  usedPercent: number | null;
  utilization: number | null;
}): number | null {
  if (input.remaining !== null && input.limit !== null && input.limit > 0) {
    return clampPercent((input.remaining / input.limit) * 100);
  }

  if (input.usedPercent !== null) {
    return clampPercent(100 - input.usedPercent);
  }

  if (input.utilization !== null) {
    const usedPercent = input.utilization <= 1 ? input.utilization * 100 : input.utilization;
    return clampPercent(100 - usedPercent);
  }

  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 1_000_000_000_000 ? value : value * 1_000;
    return new Date(timestamp).toISOString();
  }

  const candidate = asNonEmptyString(value);
  if (!candidate) {
    return null;
  }

  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeRateLimitLabel(
  rawLabel: string | null,
  windowDurationMins: number | null,
): string {
  if (windowDurationMins === 300) return "5h";
  if (windowDurationMins === 10_080) return "Weekly";

  if (!rawLabel) return "Current";

  const normalized = rawLabel
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");

  if (
    normalized === "session" ||
    normalized === "five_hour" ||
    normalized === "fivehour" ||
    normalized === "5h" ||
    normalized === "current"
  ) {
    return "5h";
  }

  if (normalized === "weekly" || normalized === "seven_day" || normalized === "7d") {
    return "Weekly";
  }

  return rawLabel.replace(/[_-]+/g, " ").replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function makeEntry(
  rawLabel: string | null,
  source: Record<string, unknown>,
): RateLimitEntry | null {
  const remaining =
    asFiniteNumber(source.remaining) ??
    asFiniteNumber(source.remainingRequests) ??
    asFiniteNumber(source.available);
  const limit =
    asFiniteNumber(source.limit) ??
    asFiniteNumber(source.max) ??
    asFiniteNumber(source.maxRequests) ??
    asFiniteNumber(source.total);
  const usedPercent = asFiniteNumber(source.usedPercent);
  const utilization = asFiniteNumber(source.utilization);
  const windowDurationMins = asFiniteNumber(source.windowDurationMins);
  const resetAt =
    toIsoDate(source.resetAt) ??
    toIsoDate(source.reset_at) ??
    toIsoDate(source.resetsAt) ??
    toIsoDate(source.windowResetAt);
  const remainingPercent = resolveRemainingPercent({
    remaining,
    limit,
    usedPercent,
    utilization,
  });

  if (remaining === null && limit === null && remainingPercent === null && resetAt === null) {
    return null;
  }

  return {
    label: normalizeRateLimitLabel(rawLabel, windowDurationMins),
    remaining,
    limit,
    remainingPercent,
    resetAt,
    windowDurationMins,
  };
}

function extractCodexStyleEntries(payload: Record<string, unknown>): RateLimitEntry[] {
  const root = asRecord(payload.rateLimits)?.rateLimits ?? payload.rateLimits ?? payload;
  const record = asRecord(root);
  if (!record) {
    return [];
  }

  const entries: RateLimitEntry[] = [];
  const primary = asRecord(record.primary);
  const secondary = asRecord(record.secondary);

  if (primary) {
    const entry = makeEntry("5h", primary);
    if (entry) {
      entries.push(entry);
    }
  }

  if (secondary) {
    const entry = makeEntry("Weekly", secondary);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function extractByIdEntries(payload: Record<string, unknown>): RateLimitEntry[] {
  const byId = asRecord(payload.rateLimitsByLimitId);
  if (!byId) {
    return [];
  }

  const entries: RateLimitEntry[] = [];

  for (const [key, value] of Object.entries(byId)) {
    const record = asRecord(value);
    if (!record) {
      continue;
    }

    const primary = asRecord(record.primary);
    const secondary = asRecord(record.secondary);
    const label = asNonEmptyString(record.label) ?? asNonEmptyString(record.window) ?? key;

    if (primary) {
      const entry = makeEntry(label, primary);
      if (entry) {
        entries.push(entry);
      }
    }

    if (secondary) {
      const entry = makeEntry("Weekly", secondary);
      if (entry) {
        entries.push(entry);
      }
    }

    if (!primary && !secondary) {
      const entry = makeEntry(label, record);
      if (entry) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

function extractClaudeStyleEntries(payload: Record<string, unknown>): RateLimitEntry[] {
  const rateLimitInfo = asRecord(payload.rate_limit_info) ?? asRecord(payload.rateLimitInfo);
  if (!rateLimitInfo) {
    return [];
  }

  const label =
    asNonEmptyString(rateLimitInfo.rateLimitType) ??
    asNonEmptyString(rateLimitInfo.window) ??
    asNonEmptyString(rateLimitInfo.bucket);
  const entry = makeEntry(label, rateLimitInfo);
  return entry ? [entry] : [];
}

function extractCollectionEntries(payload: Record<string, unknown>): RateLimitEntry[] {
  const collection = payload.rateLimits ?? payload.limits ?? payload;

  if (Array.isArray(collection)) {
    return collection.flatMap((value, index) => {
      const record = asRecord(value);
      if (!record) {
        return [];
      }
      const label =
        asNonEmptyString(record.label) ??
        asNonEmptyString(record.window) ??
        asNonEmptyString(record.bucket) ??
        `${index + 1}`;
      const entry = makeEntry(label, record);
      return entry ? [entry] : [];
    });
  }

  const record = asRecord(collection);
  if (!record) {
    return [];
  }

  return Object.entries(record).flatMap(([key, value]) => {
    const nested = asRecord(value);
    if (!nested) {
      return [];
    }

    const entry = makeEntry(key, nested);
    return entry ? [entry] : [];
  });
}

function parseEntries(payload: Record<string, unknown>): RateLimitEntry[] {
  const byIdEntries = extractByIdEntries(payload);
  if (byIdEntries.length > 0) {
    return byIdEntries;
  }

  const claudeEntries = extractClaudeStyleEntries(payload);
  if (claudeEntries.length > 0) {
    return claudeEntries;
  }

  const codexEntries = extractCodexStyleEntries(payload);
  if (codexEntries.length > 0) {
    return codexEntries;
  }

  return extractCollectionEntries(payload);
}

export function deriveRateLimitEntriesFromPayload(payload: unknown): ReadonlyArray<RateLimitEntry> {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  return parseEntries(record).toSorted(compareRows);
}

function compareRows(left: RateLimitEntry, right: RateLimitEntry): number {
  const priorityDiff =
    (WINDOW_PRIORITY.get(left.label) ?? Number.MAX_SAFE_INTEGER) -
    (WINDOW_PRIORITY.get(right.label) ?? Number.MAX_SAFE_INTEGER);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const leftPercent = left.remainingPercent ?? Number.POSITIVE_INFINITY;
  const rightPercent = right.remainingPercent ?? Number.POSITIVE_INFINITY;
  if (leftPercent !== rightPercent) {
    return leftPercent - rightPercent;
  }

  return left.label.localeCompare(right.label);
}

export function deriveLatestActivityRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ActivityRateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account.rate-limits.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    if (!payload) {
      continue;
    }

    const entries = deriveRateLimitEntriesFromPayload(payload);
    if (entries.length === 0) {
      continue;
    }

    return {
      entries,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

export function deriveLatestProviderRateLimitSnapshots(
  threads: ReadonlyArray<ThreadRateLimitSource>,
): Map<ProviderKind, ProviderRateLimitSnapshot> {
  const snapshots = new Map<ProviderKind, ProviderRateLimitSnapshot>();

  for (const thread of threads) {
    const snapshot = deriveLatestActivityRateLimitSnapshot(thread.activities);
    if (!snapshot) {
      continue;
    }

    const provider = thread.session?.provider ?? thread.modelSelection.provider;
    const current = snapshots.get(provider);

    if (!current || snapshot.updatedAt > current.updatedAt) {
      snapshots.set(provider, {
        provider,
        updatedAt: snapshot.updatedAt,
        entries: snapshot.entries,
      });
    }
  }

  return snapshots;
}

export function deriveVisibleRateLimitRows(
  entries: ReadonlyArray<RateLimitEntry>,
  options?: { readonly maxRows?: number },
): RateLimitRow[] {
  const rowsByLabel = new Map<string, RateLimitEntry>();

  for (const entry of entries) {
    const existing = rowsByLabel.get(entry.label);
    if (!existing) {
      rowsByLabel.set(entry.label, entry);
      continue;
    }

    const existingPercent = existing.remainingPercent ?? Number.POSITIVE_INFINITY;
    const candidatePercent = entry.remainingPercent ?? Number.POSITIVE_INFINITY;

    if (candidatePercent < existingPercent) {
      rowsByLabel.set(entry.label, entry);
    }
  }

  const rows = [...rowsByLabel.values()].toSorted(compareRows).map((entry) =>
    Object.assign(
      {
        id: entry.label.toLowerCase().replace(/\s+/g, "-"),
      },
      entry,
    ),
  );

  return options?.maxRows ? rows.slice(0, options.maxRows) : rows;
}

export function formatRateLimitValue(
  entry: Pick<RateLimitEntry, "remaining" | "limit" | "remainingPercent">,
): string {
  if (entry.remainingPercent !== null) {
    return `${Math.round(entry.remainingPercent)}%`;
  }

  if (entry.remaining !== null && entry.limit !== null) {
    return `${entry.remaining}/${entry.limit}`;
  }

  if (entry.remaining !== null) {
    return `${entry.remaining} left`;
  }

  return "Live";
}

export function formatRateLimitResetTime(resetAt: string | null): string | null {
  if (!resetAt) {
    return null;
  }

  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
