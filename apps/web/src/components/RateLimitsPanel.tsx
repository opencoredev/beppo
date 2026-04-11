import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { ActivityIcon, Clock3Icon } from "lucide-react";
import { useMemo } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";

interface RateLimitEntry {
  bucket: string;
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
}

interface RateLimitSnapshot {
  entries: RateLimitEntry[];
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeRateLimitEntry(bucket: string, raw: unknown): RateLimitEntry | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const remaining =
    asNumber(record.remaining) ??
    asNumber(record.remainingRequests) ??
    asNumber(record.available) ??
    null;
  const limit =
    asNumber(record.limit) ?? asNumber(record.max) ?? asNumber(record.maxRequests) ?? null;
  const resetAt =
    asString(record.resetAt) ??
    asString(record.reset_at) ??
    asString(record.resetsAt) ??
    asString(record.windowResetAt) ??
    null;

  if (remaining === null && limit === null && resetAt === null) {
    return null;
  }

  return {
    bucket,
    remaining,
    limit,
    resetAt,
  };
}

function deriveLatestRateLimits(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account.rate-limits.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const rawRateLimits = payload?.rateLimits ?? payload;
    const rateLimitEntries: RateLimitEntry[] = [];

    if (Array.isArray(rawRateLimits)) {
      for (const entry of rawRateLimits) {
        const record = asRecord(entry);
        const bucket =
          asString(record?.bucket) ?? asString(record?.name) ?? asString(record?.id) ?? "Limit";
        const normalized = normalizeRateLimitEntry(bucket, record);
        if (normalized) {
          rateLimitEntries.push(normalized);
        }
      }
    } else {
      const record = asRecord(rawRateLimits);
      if (!record) {
        continue;
      }
      for (const [bucket, entry] of Object.entries(record)) {
        const normalized = normalizeRateLimitEntry(bucket, entry);
        if (normalized) {
          rateLimitEntries.push(normalized);
        }
      }
    }

    if (rateLimitEntries.length === 0) {
      continue;
    }

    return {
      entries: rateLimitEntries.toSorted((left, right) => {
        const leftRatio =
          left.remaining !== null && left.limit !== null && left.limit > 0
            ? left.remaining / left.limit
            : Number.POSITIVE_INFINITY;
        const rightRatio =
          right.remaining !== null && right.limit !== null && right.limit > 0
            ? right.remaining / right.limit
            : Number.POSITIVE_INFINITY;
        return leftRatio - rightRatio;
      }),
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

function formatBucketLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatResetAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RateLimitsPanel(props: { activities: ReadonlyArray<OrchestrationThreadActivity> }) {
  const snapshot = useMemo(() => deriveLatestRateLimits(props.activities), [props.activities]);

  if (!snapshot) {
    return null;
  }

  const tightestLimit = snapshot.entries[0] ?? null;
  const summary =
    tightestLimit && tightestLimit.remaining !== null && tightestLimit.limit !== null
      ? `${tightestLimit.remaining}/${tightestLimit.limit}`
      : "Live";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 px-2 text-muted-foreground/72 hover:text-foreground/82"
            aria-label="Show rate limits"
          />
        }
      >
        <ActivityIcon className="size-3.5" />
        <span className="hidden sm:inline">Limits</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/82">
          {summary}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side="top"
        align="end"
        className="w-72 rounded-xl border border-border/70 bg-popover/96 p-3 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Rate Limits
            </p>
            <p className="mt-1 text-sm text-foreground">Latest provider quota snapshot</p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3Icon className="size-3" />
            {formatResetAt(snapshot.updatedAt) ?? "Updated"}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {snapshot.entries.map((entry) => (
            <div
              key={entry.bucket}
              className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {formatBucketLabel(entry.bucket)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {entry.remaining !== null && entry.limit !== null
                    ? `${entry.remaining} / ${entry.limit}`
                    : entry.remaining !== null
                      ? `${entry.remaining} remaining`
                      : "Live"}
                </span>
              </div>
              {entry.resetAt ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Resets {formatResetAt(entry.resetAt) ?? "soon"}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
