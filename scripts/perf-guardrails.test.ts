import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReplayFixture,
  buildSnapshotReadModelFixture,
  buildStreamingTurnFixture,
  readWebBundleStats,
} from "./perf-guardrails.ts";

describe("perf guardrail fixtures", () => {
  it("builds a snapshot fixture with the requested project and thread counts", () => {
    const snapshot = buildSnapshotReadModelFixture({
      projectCount: 2,
      threadsPerProject: 3,
      messagesPerThread: 4,
      activitiesPerThread: 1,
      checkpointsPerThread: 1,
    });

    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.threads).toHaveLength(6);
    expect(snapshot.threads[0]?.messages).toHaveLength(4);
    expect(snapshot.threads[0]?.checkpoints).toHaveLength(1);
  });

  it("builds a replay fixture with a stable event count", () => {
    const fixture = buildReplayFixture({
      projectCount: 1,
      threadsPerProject: 2,
      eventsPerThread: 3,
    });

    expect(fixture.threadCount).toBe(2);
    expect(fixture.eventCount).toBe(6);
    expect(fixture.initialState.threads).toHaveLength(2);
    expect(fixture.events[0]?.type).toBe("thread.message-sent");
  });

  it("builds a streaming turn fixture with the expected chunk length", () => {
    const fixture = buildStreamingTurnFixture({
      chunkCount: 3,
      chunkSize: 5,
    });

    expect(fixture.events).toHaveLength(6);
    expect(fixture.expectedTextLength).toBe(15);
    expect(fixture.events.at(-1)?.type).toBe("thread.message-sent");
  });

  it("reads bundle stats from a minimal dist directory", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "beppo-perf-bundle-"));
    try {
      mkdirSync(join(tempRoot, "assets"), { recursive: true });
      writeFileSync(
        join(tempRoot, "index.html"),
        `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="./assets/index.css" />
  </head>
  <body>
    <script type="module" src="./assets/index.js"></script>
  </body>
</html>
`,
      );
      writeFileSync(join(tempRoot, "assets/index.js"), "console.log('entry');");
      writeFileSync(join(tempRoot, "assets/index.css"), "body{}");
      writeFileSync(join(tempRoot, "assets/extra.js"), "console.log('extra');");
      writeFileSync(join(tempRoot, "assets/extra.js.map"), "{}");

      const stats = readWebBundleStats(tempRoot);

      expect(stats.entryJavaScriptBytes).toBeGreaterThan(0);
      expect(stats.totalJavaScriptBytes).toBe(stats.entryJavaScriptBytes * 2);
      expect(stats.totalCssBytes).toBe(6);
      expect(stats.totalFiles).toBe(5);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
