import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

const bunOnlyMigrationExcludes =
  typeof Bun !== "undefined"
    ? [
        "src/persistence/Migrations/016_CanonicalizeModelSelections.test.ts",
        "src/persistence/Migrations/019_ProjectionSnapshotLookupIndexes.test.ts",
        "src/persistence/Migrations/024_BackfillProjectionThreadShellSummary.test.ts",
      ]
    : [];

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide parallel runs they regularly exceed the default 15s budget.
      testTimeout: 60_000,
      hookTimeout: 60_000,
      exclude: [...bunOnlyMigrationExcludes],
    },
  }),
);
