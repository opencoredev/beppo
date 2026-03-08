import {
  DESKTOP_WS_URL_SEARCH_PARAM,
  LEGACY_DESKTOP_WS_URL_SEARCH_PARAM,
} from "@t3tools/shared/branding";

function readSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  if (typeof window.location?.href !== "string" || window.location.href.length === 0) {
    return null;
  }

  const value = new URL(window.location.href).searchParams.get(name)?.trim();
  return value && value.length > 0 ? value : null;
}

export function getDesktopWsUrl(): string | null {
  if (typeof window === "undefined") return null;

  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.()?.trim();
  if (bridgeWsUrl) {
    return bridgeWsUrl;
  }

  return (
    readSearchParam(DESKTOP_WS_URL_SEARCH_PARAM) ??
    readSearchParam(LEGACY_DESKTOP_WS_URL_SEARCH_PARAM)
  );
}

export function isDesktopRuntime(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.desktopBridge !== undefined ||
    window.nativeApi !== undefined ||
    getDesktopWsUrl() !== null
  );
}

export function resolveHttpOriginFromWsUrl(wsUrl: string): string {
  const protocol = wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

  try {
    return new URL(protocol).origin;
  } catch {
    const queryIndex = protocol.indexOf("?");
    return queryIndex === -1 ? protocol : protocol.slice(0, queryIndex);
  }
}
