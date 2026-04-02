import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const requiredPaths = [
  resolve(desktopDir, "preload.js"),
  resolve(desktopDir, "../server/dist/index.mjs"),
];

const missing = requiredPaths.filter((entry) => !existsSync(entry));
if (missing.length > 0) {
  console.error("Desktop smoke test prerequisites are missing:");
  for (const entry of missing) {
    console.error(` - ${entry}`);
  }
  process.exit(1);
}

console.log("Desktop smoke test prerequisites are present.");
