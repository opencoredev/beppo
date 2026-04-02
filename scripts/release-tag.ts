#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

function fail(message: string): never {
  console.error(`[release-tag] ${message}`);
  process.exit(1);
}

function runGit(args: string[], options?: { allowFailure?: boolean }): string {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !options?.allowFailure) {
    const stderr = result.stderr.trim();
    fail(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : "."}`);
  }

  return result.stdout.trim();
}

function pullMainWithAbortOnFailure(): void {
  const result = spawnSync("git", ["pull", "--rebase", "origin", "main"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status === 0) {
    return;
  }

  spawnSync("git", ["rebase", "--abort"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  const stderr = result.stderr.trim();
  fail(`git pull --rebase origin main failed${stderr ? `: ${stderr}` : "."}`);
}

function normalizeVersion(rawVersion: string | undefined): string {
  if (!rawVersion) {
    fail("Missing version. Usage: bun run release:tag -- 0.0.5 [--push]");
  }

  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Invalid version '${rawVersion}'. Expected something like 0.0.5 or v0.0.5.`);
  }

  return `v${version}`;
}

const args = process.argv.slice(2);
const versionArg = args.find((arg) => !arg.startsWith("-"));
const shouldPush = args.includes("--push");
const tag = normalizeVersion(versionArg);

const currentBranch = runGit(["branch", "--show-current"]);
if (currentBranch !== "main") {
  fail(`Release tags must be created from 'main'. Current branch: '${currentBranch}'.`);
}

const workingTree = runGit(["status", "--short"]);
if (workingTree.length > 0) {
  fail("Working tree is not clean. Commit or stash changes before creating a release tag.");
}

console.log(`[release-tag] Updating local main with 'git pull --rebase origin main'...`);
pullMainWithAbortOnFailure();

const existingTag = runGit(["tag", "--list", tag]);
if (existingTag === tag) {
  fail(`Tag '${tag}' already exists locally.`);
}

const remoteTag = runGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`], {
  allowFailure: true,
});
if (remoteTag.length > 0) {
  fail(
    `Tag '${tag}' already exists on origin. Pull the tag locally or choose a different version.`,
  );
}

console.log(`[release-tag] Creating annotated tag ${tag}...`);
runGit(["tag", "-a", tag, "-m", `Release ${tag}`]);

if (!shouldPush) {
  console.log(`[release-tag] Created local tag ${tag}.`);
  console.log(`[release-tag] To publish the release, run: git push origin ${tag}`);
  process.exit(0);
}

console.log(`[release-tag] Pushing ${tag} to origin...`);
runGit(["push", "origin", tag]);
console.log(`[release-tag] Pushed ${tag}. GitHub Actions should now run the release workflow.`);
