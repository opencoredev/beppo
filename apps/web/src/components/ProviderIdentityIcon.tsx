import type { ProviderKind } from "@t3tools/contracts";
import type { CSSProperties } from "react";

import { ClaudeAI, OpenAI } from "./Icons";
import { cn } from "~/lib/utils";

export const PROVIDER_ICON_COMPONENT_BY_PROVIDER = {
  claudeAgent: ClaudeAI,
  codex: OpenAI,
} as const;

const PROVIDER_ICON_TONE_CLASS_BY_PROVIDER = {
  claudeAgent: "provider-identity-icon",
  codex: "provider-identity-icon",
  cursor: "provider-identity-icon",
  gemini: "provider-identity-icon",
  opencode: "provider-identity-icon",
} as const;

const PROVIDER_ICON_STYLE_BY_PROVIDER = {
  claudeAgent: {
    color: "color-mix(in srgb, var(--provider-claude) 92%, var(--foreground))",
    filter:
      "drop-shadow(0 0.35rem 0.8rem color-mix(in srgb, var(--provider-claude-glow) 22%, transparent))",
  },
  codex: {
    color: "color-mix(in srgb, var(--provider-codex) 92%, var(--foreground))",
    filter:
      "drop-shadow(0 0.35rem 0.8rem color-mix(in srgb, var(--provider-codex-glow) 22%, transparent))",
  },
  cursor: {
    color: "color-mix(in srgb, var(--provider-cursor) 92%, var(--foreground))",
    filter:
      "drop-shadow(0 0.35rem 0.8rem color-mix(in srgb, var(--provider-cursor-glow) 22%, transparent))",
  },
  gemini: {
    color: "color-mix(in srgb, var(--provider-gemini) 92%, var(--foreground))",
    filter:
      "drop-shadow(0 0.35rem 0.8rem color-mix(in srgb, var(--provider-gemini-glow) 22%, transparent))",
  },
  opencode: {
    color: "color-mix(in srgb, var(--provider-opencode) 92%, var(--foreground))",
    filter:
      "drop-shadow(0 0.35rem 0.8rem color-mix(in srgb, var(--provider-opencode-glow) 22%, transparent))",
  },
} as const satisfies Record<keyof typeof PROVIDER_ICON_TONE_CLASS_BY_PROVIDER, CSSProperties>;

export function providerIconClassName(
  provider: keyof typeof PROVIDER_ICON_TONE_CLASS_BY_PROVIDER,
  className?: string,
): string {
  return cn(PROVIDER_ICON_TONE_CLASS_BY_PROVIDER[provider], className);
}

export function providerIconStyle(
  provider: keyof typeof PROVIDER_ICON_TONE_CLASS_BY_PROVIDER,
): CSSProperties {
  return PROVIDER_ICON_STYLE_BY_PROVIDER[provider];
}

export function ProviderIdentityIcon(props: {
  provider: ProviderKind;
  className?: string;
  title?: string;
}) {
  const Icon = PROVIDER_ICON_COMPONENT_BY_PROVIDER[props.provider];
  return (
    <span className="inline-flex shrink-0" title={props.title}>
      <Icon
        aria-hidden="true"
        className={providerIconClassName(props.provider, props.className)}
        style={providerIconStyle(props.provider)}
      />
    </span>
  );
}
