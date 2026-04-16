import { type ProviderKind, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { BotIcon, EllipsisIcon, ListTodoIcon, PlayIcon } from "lucide-react";
import { RateLimitSummaryList } from "../RateLimitSummaryList";
import { ProviderIdentityIcon } from "../ProviderIdentityIcon";
import type { RateLimitEntry } from "../../lib/rateLimits";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  providerSummary?: {
    provider: ProviderKind;
    providerLabel: string;
    modelLabel: string;
    rateLimitEntries: ReadonlyArray<RateLimitEntry>;
  } | null;
  quickCommands?: ReadonlyArray<{
    command: "model" | "plan" | "default";
    label: string;
    description: string;
  }>;
  projectScripts?: ReadonlyArray<{
    id: string;
    name: string;
    command: string;
  }>;
  traitsMenuContent?: ReactNode;
  onSelectQuickCommand: (command: "model" | "plan" | "default") => void;
  onRunProjectScript: (scriptId: string) => void;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onToggleRuntimeMode: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label="More composer controls"
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.providerSummary ? (
          <>
            <div className="px-2 pt-2 pb-1">
              <div className="rounded-lg border border-border/70 bg-muted/35 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-7 items-center justify-center rounded-lg border border-border/70 bg-background/80">
                    <ProviderIdentityIcon
                      provider={props.providerSummary.provider}
                      className="size-4"
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {props.providerSummary.providerLabel}
                    </div>
                    <div className="truncate text-muted-foreground text-xs">
                      {props.providerSummary.modelLabel}
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  <RateLimitSummaryList
                    entries={props.providerSummary.rateLimitEntries}
                    maxRows={2}
                    compact
                    emptyLabel="No limit data yet."
                  />
                </div>
              </div>
            </div>
            <MenuDivider />
          </>
        ) : null}
        {props.quickCommands && props.quickCommands.length > 0 ? (
          <>
            <MenuGroupLabel>Quick actions</MenuGroupLabel>
            {props.quickCommands.map((command) => (
              <MenuItem
                key={command.command}
                onClick={() => {
                  props.onSelectQuickCommand(command.command);
                }}
              >
                <BotIcon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">{command.label}</div>
                  <div className="truncate text-muted-foreground text-xs">
                    {command.description}
                  </div>
                </div>
              </MenuItem>
            ))}
            <MenuDivider />
          </>
        ) : null}
        {props.projectScripts && props.projectScripts.length > 0 ? (
          <>
            <MenuGroupLabel>Project actions</MenuGroupLabel>
            {props.projectScripts.map((script) => (
              <MenuItem
                key={script.id}
                onClick={() => {
                  props.onRunProjectScript(script.id);
                }}
              >
                <PlayIcon className="size-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">{script.name}</div>
                  <div className="truncate text-muted-foreground text-xs">{script.command}</div>
                </div>
              </MenuItem>
            ))}
            <MenuDivider />
          </>
        ) : null}
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
        <MenuRadioGroup
          value={props.interactionMode}
          onValueChange={(value) => {
            if (!value || value === props.interactionMode) return;
            props.onToggleInteractionMode();
          }}
        >
          <MenuRadioItem value="default">Chat</MenuRadioItem>
          <MenuRadioItem value="plan">Plan</MenuRadioItem>
        </MenuRadioGroup>
        <MenuDivider />
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onToggleRuntimeMode();
          }}
        >
          <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
          <MenuRadioItem value="full-access">Full access</MenuRadioItem>
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen ? "Hide plan sidebar" : "Show plan sidebar"}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
