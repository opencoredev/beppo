import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { ShieldAlertIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { useMemo } from "react";

import {
  deriveLatestProviderRateLimitSnapshots,
  deriveRateLimitEntriesFromPayload,
} from "../lib/rateLimits";
import { readLocalApi } from "../localApi";
import { selectThreadsAcrossEnvironments, useStore } from "../store";
import { useSettings, useUpdateSettings } from "~/hooks/useSettings";
import { ProviderIdentityIcon } from "./ProviderIdentityIcon";
import { RateLimitSummaryList } from "./RateLimitSummaryList";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "./ui/sidebar";

const PROVIDER_STATUS_DOT_CLASS: Record<ServerProvider["status"], string> = {
  ready: "bg-emerald-500",
  warning: "bg-amber-400",
  error: "bg-destructive",
  disabled: "bg-zinc-400/80",
};

function formatVersion(version: string | null): string | null {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

function hasAuthenticationProblem(provider: ServerProvider): boolean {
  if (provider.auth.status === "unauthenticated") {
    return true;
  }

  const normalizedMessage = provider.message?.toLowerCase() ?? "";
  return (
    provider.auth.status === "unknown" &&
    (provider.status === "warning" || provider.status === "error") &&
    (normalizedMessage.includes("auth") ||
      normalizedMessage.includes("sign in") ||
      normalizedMessage.includes("login") ||
      normalizedMessage.includes("timed out"))
  );
}

function getProviderStatusDotClass(provider: ServerProvider): string {
  if (hasAuthenticationProblem(provider)) {
    return PROVIDER_STATUS_DOT_CLASS.error;
  }
  return PROVIDER_STATUS_DOT_CLASS[provider.status];
}

function getProviderHeadline(provider: ServerProvider): {
  icon: typeof ShieldCheckIcon;
  label: string;
} {
  if (!provider.enabled) {
    return { icon: ShieldOffIcon, label: "Disabled" };
  }

  if (!provider.installed) {
    return { icon: ShieldAlertIcon, label: "Not installed" };
  }

  if (provider.auth.status === "authenticated") {
    return {
      icon: ShieldCheckIcon,
      label: provider.auth.label ?? provider.auth.type ?? "Authenticated",
    };
  }

  if (provider.auth.status === "unauthenticated") {
    return { icon: ShieldAlertIcon, label: "Sign in required" };
  }

  if (hasAuthenticationProblem(provider)) {
    return { icon: ShieldAlertIcon, label: "Sign in required" };
  }

  if (provider.status === "error") {
    return { icon: ShieldAlertIcon, label: "Unavailable" };
  }

  if (provider.status === "warning") {
    return { icon: ShieldAlertIcon, label: "Needs attention" };
  }

  return { icon: ShieldCheckIcon, label: "Ready" };
}

export function SidebarProviderStatusList(props: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly isLoading?: boolean;
  readonly onOpenSettings?: () => void;
}) {
  const threads = useStore(selectThreadsAcrossEnvironments);
  const appSettings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const snapshotsByProvider = useMemo(
    () => deriveLatestProviderRateLimitSnapshots(threads),
    [threads],
  );

  if (props.providers.length === 0) {
    if (!props.isLoading) {
      return null;
    }

    return (
      <SidebarGroup className="px-0 py-0">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <div className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/22 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-7 items-center justify-center rounded-lg border border-sidebar-border/70 bg-sidebar">
                  <ProviderIdentityIcon provider="codex" className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-sidebar-foreground/90">
                    Loading providers
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground/70">
                    Waiting for local provider status.
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <RateLimitSummaryList entries={[]} compact maxRows={2} />
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup className="px-0 py-0">
      <SidebarMenu className="gap-1">
        {props.providers.map((provider) => {
          const providerEntries = deriveRateLimitEntriesFromPayload(provider.rateLimits);
          const providerSnapshot =
            providerEntries.length > 0
              ? {
                  provider: provider.provider,
                  updatedAt: provider.checkedAt,
                  entries: providerEntries,
                }
              : null;
          const activitySnapshot = snapshotsByProvider.get(provider.provider);
          const snapshot =
            providerSnapshot && activitySnapshot
              ? new Date(activitySnapshot.updatedAt).getTime() >
                new Date(providerSnapshot.updatedAt).getTime()
                ? activitySnapshot
                : providerSnapshot
              : (activitySnapshot ?? providerSnapshot);
          const headline = getProviderHeadline(provider);
          const HeadlineIcon = headline.icon;
          const version = formatVersion(provider.version);
          const providerLabel = PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider;
          const authProblem = hasAuthenticationProblem(provider);
          const hoverHelp = authProblem
            ? `Log in with your ${providerLabel} account or hide this card from the sidebar.`
            : (provider.message ?? providerLabel);

          return (
            <SidebarMenuItem key={provider.provider}>
              <div
                className="group/provider rounded-xl border border-sidebar-border/70 bg-sidebar-accent/24 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
                onContextMenu={(event) => {
                  event.preventDefault();
                  const api = readLocalApi();
                  if (!api) {
                    return;
                  }
                  void api.contextMenu
                    .show(
                      [
                        { id: "hide", label: "Hide from sidebar" },
                        { id: "settings", label: "Open settings" },
                      ],
                      { x: event.clientX, y: event.clientY },
                    )
                    .then((clicked: "hide" | "settings" | null) => {
                      if (clicked === "hide") {
                        updateSettings({
                          sidebarProviderVisibility: {
                            ...appSettings.sidebarProviderVisibility,
                            [provider.provider]: false,
                          },
                        });
                        return;
                      }
                      if (clicked === "settings") {
                        props.onOpenSettings?.();
                      }
                    })
                    .catch(() => undefined);
                }}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-sidebar-border/70 bg-sidebar">
                      <ProviderIdentityIcon
                        provider={provider.provider as ProviderKind}
                        className="size-3.5"
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-sidebar-foreground/95">
                          {providerLabel}
                        </span>
                        {version ? (
                          <span className="text-[10px] font-medium text-muted-foreground/55">
                            {version}
                          </span>
                        ) : null}
                      </div>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/75">
                              <HeadlineIcon className="size-3" />
                              <span
                                className={`truncate ${authProblem ? "text-destructive/90" : ""}`}
                              >
                                {headline.label}
                              </span>
                            </div>
                          }
                        />
                        <TooltipPopup side="top" className="max-w-56 text-[11px] leading-relaxed">
                          {hoverHelp}
                        </TooltipPopup>
                      </Tooltip>
                    </div>
                  </div>
                  <span
                    className={`mt-1 inline-flex size-2.5 shrink-0 rounded-full ${getProviderStatusDotClass(
                      provider,
                    )}`}
                    aria-label={`${providerLabel} status ${provider.status}`}
                    title={provider.status}
                  />
                </div>

                <div className="mt-2">
                  <RateLimitSummaryList entries={snapshot?.entries ?? []} maxRows={2} compact />
                </div>

                {provider.message && !authProblem ? (
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/55">
                    {provider.message}
                  </p>
                ) : null}
              </div>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
