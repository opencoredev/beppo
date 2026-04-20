import type { ServerProviderUpdatedPayload } from "@t3tools/contracts";

export async function refreshProvidersAndApply({
  refreshProviders,
  applyProviders,
  addToast,
}: {
  refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
  applyProviders: (payload: ServerProviderUpdatedPayload) => void;
  addToast: (input: { type: "error"; title: string; description: string }) => void;
}): Promise<void> {
  try {
    const refreshedProviders = await refreshProviders();
    applyProviders(refreshedProviders);
  } catch (error) {
    console.warn("Failed to refresh providers", error);
    addToast({
      type: "error",
      title: "Could not refresh provider status",
      description:
        error instanceof Error ? error.message : "We could not refresh the provider status.",
    });
  }
}
