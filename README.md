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

## Current Status

- Very early work in progress
- Codex is the primary supported provider right now
- Reliability and performance are prioritized over feature breadth
- Contributions are not open yet

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

Before considering work complete in this repo, both of these must pass:

```bash
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

## Notes

- Expect rough edges while the session model and provider orchestration are still evolving
- Session startup and turn lifecycle are centered around Codex App Server
- The system is designed to behave predictably during reconnects, restarts, and partial stream failures

## Community

Need support or want to follow development?

[Join the Discord](https://discord.gg/jn4EGJjrvv)
