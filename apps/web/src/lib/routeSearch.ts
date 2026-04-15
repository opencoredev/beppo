import { ThreadId } from "@t3tools/contracts";

export function normalizeDraftThreadId(value: unknown): ThreadId | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? (normalized as ThreadId) : undefined;
}
