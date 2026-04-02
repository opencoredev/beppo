import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql`PRAGMA table_info(projection_threads)`;
  const hasArchivedAt = columns.some((column) => {
    const name = column?.name;
    return typeof name === "string" && name === "archived_at";
  });

  if (hasArchivedAt) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN archived_at TEXT DEFAULT NULL
  `;
});
