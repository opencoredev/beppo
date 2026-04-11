import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const PINNED_THREADS_STORAGE_KEY = "beppo:pinned-threads:v1";

function createPinnedThreadsStorage() {
  return createJSONStorage(() =>
    resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
  );
}

interface PinnedThreadsState {
  pinnedThreadIds: ThreadId[];
  togglePinnedThread: (threadId: ThreadId) => void;
  setThreadPinned: (threadId: ThreadId, pinned: boolean) => void;
  syncThreadIds: (validThreadIds: readonly ThreadId[]) => void;
  isThreadPinned: (threadId: ThreadId) => boolean;
}

export const usePinnedThreadsStore = create<PinnedThreadsState>()(
  persist(
    (set, get) => ({
      pinnedThreadIds: [],
      togglePinnedThread: (threadId) => {
        set((state) => ({
          pinnedThreadIds: state.pinnedThreadIds.includes(threadId)
            ? state.pinnedThreadIds.filter((id) => id !== threadId)
            : [...state.pinnedThreadIds, threadId],
        }));
      },
      setThreadPinned: (threadId, pinned) => {
        set((state) => {
          const isPinned = state.pinnedThreadIds.includes(threadId);
          if (pinned === isPinned) {
            return state;
          }
          return {
            pinnedThreadIds: pinned
              ? [...state.pinnedThreadIds, threadId]
              : state.pinnedThreadIds.filter((id) => id !== threadId),
          };
        });
      },
      syncThreadIds: (validThreadIds) => {
        const validThreadIdSet = new Set(validThreadIds);
        set((state) => {
          const nextPinnedThreadIds = state.pinnedThreadIds.filter((id) =>
            validThreadIdSet.has(id),
          );
          return nextPinnedThreadIds.length === state.pinnedThreadIds.length
            ? state
            : { pinnedThreadIds: nextPinnedThreadIds };
        });
      },
      isThreadPinned: (threadId) => get().pinnedThreadIds.includes(threadId),
    }),
    {
      name: PINNED_THREADS_STORAGE_KEY,
      storage: createPinnedThreadsStorage(),
      partialize: (state) => ({
        pinnedThreadIds: state.pinnedThreadIds,
      }),
    },
  ),
);
