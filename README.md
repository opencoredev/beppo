# Beppo

<p align="center">
  <img src="./beppo-social-img.png" alt="Beppo social image" width="1200" />
</p>

<p align="center">
  A fast, minimal GUI for code agents.
  <br />
  Codex-first today, with Claude Code support planned.
</p>

Beppo is an early-stage interface for running coding agents with a UI that stays responsive, predictable, and robust under real session load. The current stack centers on Codex App Server, with the browser UI and desktop shell both built from the same monorepo.

## Feature Highlights

- Chat-first thread management with faster project and session navigation
- Multi-provider model picking with first-class provider identity across the UI
- Pinned threads for quickly resurfacing important sessions
- Global command palette for fast navigation, theme switching, and agent controls
- Plan sidebar with copy, download, and save-to-workspace actions
- Pull request checkout flow for turning a PR into a local or worktree-backed thread
- Thread terminal drawer with split terminals and multi-terminal management
- Smart notifications for completions, errors, and input-needed moments
- Context window and rate-limit visibility while an agent is running
- Smoother day-to-day developer UX around sidebar, threads, and session controls

## Inspiration

Some of Beppo's session-management and sidebar polish was inspired by [dpcode](https://github.com/Emanuele-web04/dpcode), especially the ideas around:

- pinned threads
- provider logos and identity cues
- command palette driven navigation
- notification ergonomics
- plan-centric side surfaces
- richer session chrome around agent workflows

These features were not copied 1:1 on purpose. Beppo adapts them to fit its own architecture, existing terminal and diff flows, and its own product direction.

## Current Status

- Very early work in progress
- Codex is the primary supported provider right now
- Beppo is an opinionated fork with its own product direction
- Reliability, performance, and ambitious feature work are all core priorities
- Contributions are open and encouraged

## What Is In This Repo

- `apps/server`: Node.js WebSocket server that wraps `codex app-server`, manages sessions, and serves the web app
- `apps/web`: React/Vite client for conversations, session state, and streamed agent events
- `apps/desktop`: Electrobun desktop wrapper for Beppo
- `apps/marketing`: Astro marketing site
- `packages/contracts`: Shared schemas and TypeScript contracts
- `packages/shared`: Shared runtime utilities for server and web

## Prerequisites

- `bun` `^1.3.9`
- `node` `^24.13.1`
- A working `codex` CLI install for local Codex-backed sessions

## Quick Start

```bash
bun install
bun dev
```

Useful variants:

```bash
bun dev:web
bun dev:server
bun dev:desktop
```

## Quality Checks

Before considering work complete in this repo, all of these must pass:

```bash
bun fmt
bun lint
bun typecheck
```

For tests, use:

```bash
bun run test
```

## Desktop App

If you just want to use Beppo instead of developing it, install the desktop app from the releases page:

[Download Beppo Desktop](https://github.com/opencoredev/beppo/releases)

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

## Notes

- Expect rough edges while the session model and provider orchestration are still evolving
- Session startup and turn lifecycle are centered around Codex App Server
- The system is designed to behave predictably during reconnects, restarts, and partial stream failures
