import { useMemo } from "react";

import {
  deriveVisibleRateLimitRows,
  formatRateLimitResetTime,
  formatRateLimitValue,
  type RateLimitEntry,
} from "../lib/rateLimits";

export function RateLimitSummaryList(props: {
  readonly entries: ReadonlyArray<RateLimitEntry>;
  readonly maxRows?: number;
  readonly emptyLabel?: string;
  readonly showResetTimes?: boolean;
  readonly compact?: boolean;
}) {
  const rows = useMemo(
    () =>
      deriveVisibleRateLimitRows(
        props.entries,
        props.maxRows === undefined ? undefined : { maxRows: props.maxRows },
      ),
    [props.entries, props.maxRows],
  );
  const compactRows = useMemo(() => {
    const rowsByLabel = new Map(rows.map((row) => [row.label, row] as const));
    const labels = ["5h", "Weekly"] as const;

    return labels.slice(0, props.maxRows ?? labels.length).map((label, index) => {
      const entry = rowsByLabel.get(label);
      if (entry) {
        return Object.assign({}, entry, { placeholder: false });
      }

      return {
        id: `rate-limit-placeholder-${index}-${label.toLowerCase()}`,
        label,
        remaining: null,
        limit: null,
        remainingPercent: null,
        resetAt: null,
        windowDurationMins: null,
        placeholder: true,
      };
    });
  }, [props.maxRows, rows]);

  if (props.compact) {
    return (
      <div className="space-y-2">
        {compactRows.map((row) => {
          const remainingPercent = row.remainingPercent ?? 0;
          const valueLabel = row.placeholder ? "—" : formatRateLimitValue(row);
          return (
            <div key={row.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-medium text-sidebar-foreground/72">{row.label}</span>
                <span className="tabular-nums text-muted-foreground/70">{valueLabel}</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-sidebar-accent/55 ring-1 ring-inset ring-sidebar-border/70"
                title={
                  row.resetAt
                    ? `${row.label} resets ${formatRateLimitResetTime(row.resetAt) ?? "soon"}`
                    : row.label
                }
              >
                <div
                  className={`h-full rounded-full ${
                    row.placeholder ? "bg-sidebar-foreground/14" : "bg-sidebar-primary/80"
                  }`}
                  style={{ width: `${remainingPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60">
        {props.emptyLabel ?? "No rate limit data yet."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const resetLabel = formatRateLimitResetTime(row.resetAt);
        return (
          <div key={row.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-foreground">{row.label}</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="tabular-nums text-foreground">{formatRateLimitValue(row)}</span>
              {props.showResetTimes && resetLabel ? (
                <span className="tabular-nums">{resetLabel}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
