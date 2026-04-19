import type { ServerProvider } from "@t3tools/contracts";
import { Duration, Effect, PubSub, Ref, Scope, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import type { ServerProviderShape } from "./Services/ServerProvider";
import { ServerSettingsError } from "@t3tools/contracts";

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  Settings,
>(input: {
  readonly getSettings: Effect.Effect<Settings>;
  readonly streamSettings: Stream.Stream<Settings>;
  readonly haveSettingsChanged: (previous: Settings, next: Settings) => boolean;
  readonly buildInitialSnapshot: (settings: Settings) => ServerProvider;
  readonly checkProvider: Effect.Effect<ServerProvider, ServerSettingsError>;
  readonly refreshInterval?: Duration.Input;
}): Effect.fn.Return<ServerProviderShape, ServerSettingsError, Scope.Scope> {
  const refreshSemaphore = yield* Semaphore.make(1);
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerProvider>(),
    PubSub.shutdown,
  );
  const initialSettings = yield* input.getSettings;
  // This placeholder snapshot is stamped at construction time. Once the
  // background probe finishes, it overwrites `checkedAt` with the real probe
  // completion timestamp.
  const initialSnapshot = input.buildInitialSnapshot(initialSettings);
  const snapshotRef = yield* Ref.make(initialSnapshot);
  const settingsRef = yield* Ref.make(initialSettings);

  const applySnapshotBase = Effect.fn("applySnapshot")(function* (
    nextSettings: Settings,
    options?: { readonly forceRefresh?: boolean },
  ) {
    const forceRefresh = options?.forceRefresh === true;
    const previousSettings = yield* Ref.get(settingsRef);
    if (!forceRefresh && !input.haveSettingsChanged(previousSettings, nextSettings)) {
      yield* Ref.set(settingsRef, nextSettings);
      return yield* Ref.get(snapshotRef);
    }

    const nextSnapshot = yield* input.checkProvider;
    yield* Ref.set(settingsRef, nextSettings);
    yield* Ref.set(snapshotRef, nextSnapshot);
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    return nextSnapshot;
  });
  const applySnapshot = (nextSettings: Settings, options?: { readonly forceRefresh?: boolean }) =>
    refreshSemaphore.withPermits(1)(applySnapshotBase(nextSettings, options));

  const refreshSnapshot = Effect.fn("refreshSnapshot")(function* () {
    const nextSettings = yield* input.getSettings;
    return yield* applySnapshot(nextSettings, { forceRefresh: true });
  });

  yield* Stream.runForEach(input.streamSettings, (nextSettings) =>
    Effect.asVoid(applySnapshot(nextSettings)),
  ).pipe(Effect.forkScoped);

  yield* Effect.forever(
    Effect.sleep(input.refreshInterval ?? "60 seconds").pipe(
      Effect.flatMap(() => refreshSnapshot()),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  // Do the first real provider probe in the background so server startup and
  // route mounting are not blocked on CLI health checks.
  yield* refreshSnapshot().pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

  return {
    getSnapshot: Ref.get(snapshotRef),
    refresh: refreshSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ServerProviderShape;
});
