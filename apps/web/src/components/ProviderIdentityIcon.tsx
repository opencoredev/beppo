import type { ProviderKind } from "@t3tools/contracts";

import { ClaudeAI, OpenAI } from "./Icons";
import { cn } from "~/lib/utils";

export const PROVIDER_ICON_COMPONENT_BY_PROVIDER = {
  claudeAgent: ClaudeAI,
  codex: OpenAI,
} as const;

export function providerIconClassName(provider: ProviderKind, className?: string): string {
  if (provider === "claudeAgent") {
    return cn("text-[#d97757]", className);
  }
  return cn("text-foreground/78", className);
}

export function ProviderIdentityIcon(props: {
  provider: ProviderKind;
  className?: string;
  title?: string;
}) {
  const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[props.provider];
  return (
    <span className="inline-flex shrink-0" title={props.title}>
      <Icon aria-hidden="true" className={providerIconClassName(props.provider, props.className)} />
    </span>
  );
}
