import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_requested_turn_desc
    ON projection_turns(thread_id, requested_at DESC, turn_id DESC)
    WHERE turn_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_pending_requested_desc
    ON projection_turns(thread_id, requested_at DESC)
    WHERE turn_id IS NULL
      AND state = 'pending'
      AND checkpoint_turn_count IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_checkpoint_order
    ON projection_turns(
      thread_id,
      CASE WHEN checkpoint_turn_count IS NULL THEN 1 ELSE 0 END,
      checkpoint_turn_count,
      requested_at,
      turn_id
    )
  `;
});
