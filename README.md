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

### macOS release note

The latest desktop release is live, but macOS builds are currently shipped without Apple signing/notarization. That means some Mac users will see Apple's "could not verify" warning when opening Beppo for the first time.

This does not mean the app is known-malicious. It means the current release pipeline does not yet have the Apple Developer signing credentials needed for the normal Gatekeeper approval path.

Current state:

- Linux and desktop asset-path packaging issues have been fixed in the latest release
- The latest public desktop release is `v0.0.13`
- macOS still requires a manual first-run workaround until Apple signing and notarization are configured

macOS workaround:

1. Drag `Beppo.app` into `Applications`
2. In Finder, `Control-click` `Beppo.app`
3. Choose `Open`
4. In the warning dialog, click `Open`

If macOS still blocks it:

1. Open `System Settings`
2. Go to `Privacy & Security`
3. Find the Beppo security warning near the bottom
4. Click `Open Anyway`

Terminal fallback:

```bash
xattr -dr com.apple.quarantine /Applications/Beppo.app
open /Applications/Beppo.app
```

Long term fix:

- Proper Mac distribution requires Apple code signing and notarization
- Until those credentials are configured in GitHub Actions, macOS releases will continue to need the manual first-run workaround

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).

## Notes

- Expect rough edges while the session model and provider orchestration are still evolving
- Session startup and turn lifecycle are centered around Codex App Server
- The system is designed to behave predictably during reconnects, restarts, and partial stream failures
