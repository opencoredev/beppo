import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const isBunRuntime = typeof Bun !== "undefined";
const nodeSqliteClientModule = isBunRuntime ? null : await import("../NodeSqliteClient.ts");

if (isBunRuntime) {
  it.skip("021_ProjectionThreadProposedPlanImplementationRecovery", () => {});
} else {
  const layer = it.layer(Layer.mergeAll(nodeSqliteClientModule!.layerMemory()));

  layer("021_ProjectionThreadProposedPlanImplementationRecovery", (it) => {
    it.effect(
      "repairs the proposed-plan implementation columns when migration 14 was already recorded under the archived-at name",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;

          yield* runMigrations({ toMigrationInclusive: 13 });

          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name)
            VALUES (${14}, ${"ProjectionThreadsArchivedAt"})
          `;

          const beforeColumns = yield* sql<{ readonly name: string }>`
            PRAGMA table_info(projection_thread_proposed_plans)
          `;
          assert.deepStrictEqual(
            beforeColumns.map((column) => column.name),
            ["plan_id", "thread_id", "turn_id", "plan_markdown", "created_at", "updated_at"],
          );

          yield* runMigrations({ toMigrationInclusive: 21 });

          const afterColumns = yield* sql<{ readonly name: string }>`
            PRAGMA table_info(projection_thread_proposed_plans)
          `;
          assert.deepStrictEqual(
            afterColumns.map((column) => column.name),
            [
              "plan_id",
              "thread_id",
              "turn_id",
              "plan_markdown",
              "created_at",
              "updated_at",
              "implemented_at",
              "implementation_thread_id",
            ],
          );

          const migrationRows = yield* sql<{
            readonly migrationId: number;
            readonly name: string;
          }>`
            SELECT migration_id AS "migrationId", name
            FROM effect_sql_migrations
            WHERE migration_id IN (14, 21)
            ORDER BY migration_id
          `;
          assert.deepStrictEqual(migrationRows, [
            { migrationId: 14, name: "ProjectionThreadsArchivedAt" },
            {
              migrationId: 21,
              name: "ProjectionThreadProposedPlanImplementationRecovery",
            },
          ]);
        }),
    );
  });
}
