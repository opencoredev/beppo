#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const shouldSkip =
  process.env.VERCEL === "1" ||
  process.env.VERCEL === "true" ||
  process.env.T3_SKIP_EFFECT_PATCH === "1";

if (shouldSkip) {
  console.log("[prepare] Skipping effect-language-service patch for this environment.");
  process.exit(0);
}

const command = process.platform === "win32" ? "bunx.cmd" : "bunx";
const result = spawnSync(command, ["effect-language-service", "patch"], {
  stdio: "inherit",
});

if (result.error) {
  console.error("[prepare] Failed to run effect-language-service patch.", result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
