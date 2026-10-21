# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Report a missing Pi executable before opening a terminal. Windows searches
  `PATH` and `PATHEXT`. An npm `pi.cmd` shim is launched with `cmd.exe /d /c`
  and escaped arguments, because VS Code does not resolve that shim from a
  bare shell name. macOS and Linux check the extension-host `PATH`, then a
  quoted `command -v` in the same non-interactive login shell used to launch.
- Keep a Pi tab open when the process exits with a non-zero code so the error
  stays readable. Successful exits still close the tab.
- Discover Python 3 on `PATH`, and ignore a Python 2 interpreter that only has
  a `pty` module.
- Stop Windows profile mode from typing `exit` into an interactive Pi session.
- Bind a new chat to the concrete editor column when its terminal tab opens,
  so the next chat can reuse that group.
- Make **Insert into Chat** open a chat when none is open, and explain when
  no file or folder is selected.
- Restore the canonical MIT license text so Marketplace and Open VSX detect
  MIT. Scope and upstream icon license text now live in `NOTICE`.
- Leave agent notes and the publishing guide out of the packaged VSIX.
- Keep repository text files on LF so a Windows checkout does not rewrite the
  MIT license text.

### Changed

- Settings title is **Pi Coding Agent**. Marketplace categories are **AI** and
  **Chat**, and the Q&A link points at GitHub issues.
- Launch diagnostics no longer record the working-directory path.

## [0.2.0] - 2026-08-15

### Added

- Editor-area Pi terminal tabs with concrete terminal identity and editor-group
  reuse.
- Per-chat working-directory selection and configurable session-title length.
- File and folder insertion through context menus, editor moves, and supported
  modifier-assisted drops.
- Cross-platform launch planning with a dependency-free Unix PTY adapter.
- A Pi Coding Agent output channel for launch-mode diagnostics.
- Repository metadata, CI, architecture documentation, contribution guidance,
  a security policy, and automated tests.
- Explicit untrusted and virtual workspace restrictions.

[Unreleased]: https://github.com/peilundai/pi-tabs/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/peilundai/pi-tabs/releases/tag/v0.2.0

