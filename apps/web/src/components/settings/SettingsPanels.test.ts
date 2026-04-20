import { describe, expect, it, vi } from "vitest";
import type { ServerProvider } from "@t3tools/contracts";

import { refreshProvidersAndApply } from "./settingsPanels.logic";

describe("refreshProvidersAndApply", () => {
  it("applies the returned provider snapshot immediately", async () => {
    const refreshedProviders = {
      providers: [
        {
          provider: "codex",
          enabled: true,
          installed: true,
          version: "0.116.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-01-01T00:00:00.000Z",
          models: [],
        } satisfies ServerProvider,
      ],
    } as const;
    const refreshProviders = vi.fn().mockResolvedValue(refreshedProviders);
    const applyProviders = vi.fn();
    const addToast = vi.fn();

    await refreshProvidersAndApply({
      refreshProviders,
      applyProviders,
      addToast,
    });

    expect(refreshProviders).toHaveBeenCalledOnce();
    expect(applyProviders).toHaveBeenCalledWith(refreshedProviders);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("surfaces refresh failures to the user", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const refreshProviders = vi.fn().mockRejectedValue(new Error("refresh failed"));
    const applyProviders = vi.fn();
    const addToast = vi.fn();

    await refreshProvidersAndApply({
      refreshProviders,
      applyProviders,
      addToast,
    });

    expect(refreshProviders).toHaveBeenCalledOnce();
    expect(applyProviders).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Could not refresh provider status",
        description: "refresh failed",
      }),
    );
    warnSpy.mockRestore();
  });
});
