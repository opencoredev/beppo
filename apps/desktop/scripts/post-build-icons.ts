import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const buildDir = process.env.ELECTROBUN_BUILD_DIR?.trim();
const targetOs = process.env.ELECTROBUN_OS?.trim();
const rootBunStoreDir = resolve(import.meta.dir, "../../../node_modules/.bun");
const serverNodeModulesDir = resolve(import.meta.dir, "../../server/node_modules");
const serverRuntimeDependencies = ["node-pty"];

if (!buildDir) {
  process.exit(0);
}

const resolvedBuildDir = resolve(buildDir);
const iconSource = resolve(import.meta.dir, "../resources/icon.icns");

function collectReferencedBunStoreEntries(
  sourceStoreDir: string,
  storeEntries: Set<string>,
): void {
  const resolvedStoreDir = realpathSync(sourceStoreDir);
  if (storeEntries.has(resolvedStoreDir)) {
    return;
  }
  storeEntries.add(resolvedStoreDir);

  const storeNodeModulesDir = join(resolvedStoreDir, "node_modules");
  if (!existsSync(storeNodeModulesDir)) {
    return;
  }

  const visitDependencyDirectory = (dependencyDir: string) => {
    for (const entry of readdirSync(dependencyDir, { withFileTypes: true })) {
      const entryPath = join(dependencyDir, entry.name);
      if (entry.isSymbolicLink()) {
        const resolvedEntry = realpathSync(entryPath);
        if (!resolvedEntry.startsWith(`${rootBunStoreDir}${sep}`)) {
          continue;
        }
        const relativeStorePath = relative(rootBunStoreDir, resolvedEntry);
        const [storeEntryName] = relativeStorePath.split(sep);
        if (!storeEntryName) {
          continue;
        }
        collectReferencedBunStoreEntries(join(rootBunStoreDir, storeEntryName), storeEntries);
        continue;
      }

      if (entry.isDirectory() && entry.name.startsWith("@")) {
        visitDependencyDirectory(entryPath);
      }
    }
  };

  visitDependencyDirectory(storeNodeModulesDir);
}

function vendorServerRuntime(appRootDir: string): void {
  const destinationServerNodeModulesDir = join(appRootDir, "apps/server/node_modules");
  const destinationBunStoreDir = join(appRootDir, "node_modules/.bun");
  const storeEntries = new Set<string>();

  mkdirSync(destinationServerNodeModulesDir, { recursive: true });
  mkdirSync(destinationBunStoreDir, { recursive: true });

  for (const dependency of serverRuntimeDependencies) {
    const sourceDependencyPath = join(serverNodeModulesDir, ...dependency.split("/"));
    if (!existsSync(sourceDependencyPath)) {
      console.warn(`[post-build-icons] missing server runtime dependency: ${dependency}`);
      continue;
    }

    const destinationDependencyPath = join(destinationServerNodeModulesDir, ...dependency.split("/"));
    mkdirSync(dirname(destinationDependencyPath), { recursive: true });
    cpSync(sourceDependencyPath, destinationDependencyPath, {
      recursive: true,
      dereference: false,
      force: true,
    });

    const resolvedDependencyPath = realpathSync(sourceDependencyPath);
    if (!resolvedDependencyPath.startsWith(`${rootBunStoreDir}${sep}`)) {
      continue;
    }

    const relativeStorePath = relative(rootBunStoreDir, resolvedDependencyPath);
    const [storeEntryName] = relativeStorePath.split(sep);
    if (!storeEntryName) {
      continue;
    }
    collectReferencedBunStoreEntries(join(rootBunStoreDir, storeEntryName), storeEntries);
  }

  for (const sourceStoreDir of storeEntries) {
    const storeEntryName = sourceStoreDir.split(sep).at(-1);
    if (!storeEntryName) {
      continue;
    }

    const destinationStoreDir = join(destinationBunStoreDir, storeEntryName);
    cpSync(sourceStoreDir, destinationStoreDir, {
      recursive: true,
      dereference: false,
      force: true,
    });
  }
}

function findBundledAppRoots(searchDir: string): string[] {
  if (existsSync(join(searchDir, "apps/server/dist/index.mjs"))) {
    return [searchDir];
  }

  const appRoots: string[] = [];
  for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    appRoots.push(...findBundledAppRoots(join(searchDir, entry.name)));
  }
  return appRoots;
}

for (const appRootDir of findBundledAppRoots(resolvedBuildDir)) {
  vendorServerRuntime(appRootDir);
}

if (targetOs !== "macos") {
  process.exit(0);
}

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
