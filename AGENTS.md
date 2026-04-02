# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

Beppo is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

Beppo is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Release Workflow

- Beppo releases are intentionally grouped. Do not assume every merge to `main` should ship a release.
- Merging a PR into `main` does not create a release by itself. The release workflow runs only when a version tag like `v0.0.5` is pushed, or when `release.yml` is triggered manually.
- Preferred release flow:
  1. Merge the PRs you want into `main`.
  2. When ready to ship, run `bun run release:tag -- 0.0.5` from a clean local `main` branch.
  3. That command creates a local annotated tag after `git pull --rebase origin main`.
  4. Push the tag with `git push origin v0.0.5` when you are ready to publish.
- `bun run release:tag -- 0.0.5 --push` is allowed when you explicitly want the helper to push the tag immediately.
- Release tags must use the `vX.Y.Z` format because `.github/workflows/release.yml` listens for `v*.*.*`.
- Successful tagged releases publish a real GitHub Release page with downloadable desktop assets for macOS, Linux, and Windows. Do not describe a release as complete if only the tag exists.
- Expected tagged release runtime is roughly 6 to 8 minutes end-to-end: about 2 to 3 minutes for preflight, about 3 to 4 minutes for desktop builds, then the release publish step.
- When asked to "ship", "cut a release", or "deploy" Beppo, the default action is: update `main`, create or push the next `vX.Y.Z` tag, and monitor the `Release Beppo` workflow until the GitHub Release page exists and assets are attached.
- The `Publish CLI to npm` job is non-blocking for desktop releases. A release is still valid if the GitHub Release page and desktop assets publish successfully even when npm publish fails.
