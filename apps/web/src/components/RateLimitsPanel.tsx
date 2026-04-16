import { ActivityIcon, Clock3Icon } from "lucide-react";
import { useMemo } from "react";

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  deriveLatestActivityRateLimitSnapshot,
  formatRateLimitResetTime,
  formatRateLimitValue,
} from "../lib/rateLimits";
import { RateLimitSummaryList } from "./RateLimitSummaryList";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";

export function RateLimitsPanel(props: { activities: ReadonlyArray<OrchestrationThreadActivity> }) {
  const snapshot = useMemo(
    () => deriveLatestActivityRateLimitSnapshot(props.activities),
    [props.activities],
  );

  if (!snapshot) {
    return null;
  }

  const tightestLimit = snapshot.entries[0] ?? null;
  const summary = tightestLimit ? formatRateLimitValue(tightestLimit) : "Live";

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
            {formatRateLimitResetTime(snapshot.updatedAt) ?? "Updated"}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2.5">
          <RateLimitSummaryList entries={snapshot.entries} showResetTimes />
        </div>
      </PopoverPopup>
    </Popover>
  );
}
