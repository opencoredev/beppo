import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const isBunRuntime = typeof Bun !== "undefined";
const nodeSqliteClientModule = isBunRuntime ? null : await import("../NodeSqliteClient.ts");

if (isBunRuntime) {
  it.skip("020_ProjectionTurnsHotQueryIndexes", () => {});
} else {
  const layer = it.layer(Layer.mergeAll(nodeSqliteClientModule!.layerMemory()));

  layer("020_ProjectionTurnsHotQueryIndexes", (it) => {
    it.effect("creates indexes for the hot projection_turns read paths", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 19 });
        yield* runMigrations({ toMigrationInclusive: 20 });

        const indexes = yield* sql<{
          readonly name: string;
          readonly sql: string | null;
        }>`
          SELECT name, sql
          FROM sqlite_master
          WHERE type = 'index'
            AND tbl_name = 'projection_turns'
            AND name IN (
              'idx_projection_turns_thread_requested_turn_desc',
              'idx_projection_turns_thread_pending_requested_desc',
              'idx_projection_turns_thread_checkpoint_order'
            )
          ORDER BY name
        `;

        assert.deepStrictEqual(
          indexes.map((index) => index.name),
          [
            "idx_projection_turns_thread_checkpoint_order",
            "idx_projection_turns_thread_pending_requested_desc",
            "idx_projection_turns_thread_requested_turn_desc",
          ],
        );

        const definitions = new Map(indexes.map((index) => [index.name, index.sql ?? ""]));
        assert.ok(
          definitions
            .get("idx_projection_turns_thread_requested_turn_desc")
            ?.includes("ON projection_turns(thread_id, requested_at DESC, turn_id DESC)"),
        );
        assert.ok(
          definitions
            .get("idx_projection_turns_thread_pending_requested_desc")
            ?.includes("WHERE turn_id IS NULL"),
        );
        assert.ok(
          definitions
            .get("idx_projection_turns_thread_checkpoint_order")
            ?.includes("CASE WHEN checkpoint_turn_count IS NULL THEN 1 ELSE 0 END"),
        );
      }),
    );
  });
}
