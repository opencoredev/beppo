import { cpSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR?.trim();
const targetOs = process.env.ELECTROBUN_OS?.trim();

if (!buildDir || targetOs !== "macos") {
  process.exit(0);
}

const resolvedBuildDir = resolve(buildDir);
const iconSource = resolve(import.meta.dir, "../resources/icon.icns");

if (!existsSync(iconSource)) {
  console.warn(`[post-build-icons] missing icon source: ${iconSource}`);
  process.exit(0);
}

const appBundleName = readdirSync(resolvedBuildDir).find((entry) => entry.endsWith(".app"));
if (!appBundleName) {
  console.warn(`[post-build-icons] no macOS app bundle found in ${resolvedBuildDir}`);
  process.exit(0);
}

const appIconDestination = join(
  resolvedBuildDir,
  appBundleName,
  "Contents",
  "Resources",
  "AppIcon.icns",
);

cpSync(iconSource, appIconDestination, { dereference: true });
