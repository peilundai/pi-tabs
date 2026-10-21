# Pi Coding Agent Tabs

An unofficial, open-source extension for running [Pi Coding Agent](https://pi.dev)
in editor-area terminal tabs in Visual Studio Code and Cursor.

Keep independent Pi chats in one editor group, follow Pi session titles, and
insert files or folders as `@` mentions.

> This extension is not affiliated with or endorsed by Pi, Earendil, or Mario
> Zechner. Pi must be installed and configured separately.

[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Requires Pi CLI](https://img.shields.io/badge/requires-Pi%20CLI-09090b.svg)](https://pi.dev)

## Features

- Open Pi in an editor tab beside your current editor.
- Reuse one editor group for additional, independent chats.
- Reveal the most recently used live chat without creating duplicates.
- Follow Pi's built-in session titles.
- Insert files and folders as relative or absolute Pi `@` mentions.
- Support local, multi-root, and remote workspaces.

The extension does not bundle Pi, access conversations or credentials, proxy
model traffic, or collect telemetry.

## Requirements

Install Pi Coding Agent and configure its providers and authentication:

```bash
npm install -g @earendil-works/pi-coding-agent
```

See [pi.dev](https://pi.dev) for Pi setup instructions. On macOS and Linux, a
Python 3 installation with the standard Unix `pty` module enables compact
session titles and modifier-drop integration.

## Commands

| Command | Description |
| --- | --- |
| **Pi: Open Agent** | Reveal the most recently used chat, or create one if needed. |
| **Pi: New Agent Chat** | Create an independent chat in the Pi editor group. |
| **Pi: Insert into Chat** | Insert selected files or folders into the active chat. |

**New Agent Chat** is also available from the editor-title Pi button.
**Insert into Chat** is available from Explorer and editor context menus.

## File mentions

Selected resources are formatted for Pi without trailing whitespace:

```text
@src/server.ts
@"docs/design notes.md"
@/tmp/screenshot.png
```

Paths inside the chat's working directory are relative; paths outside it remain
absolute. You can also move an editor tab into the Pi group or use a supported
modifier-assisted terminal drop on macOS and Linux.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `piAgent.command` | `pi` | Pi executable name or path; shell expressions are not supported. |
| `piAgent.args` | `[]` | Arguments passed to Pi. |
| `piAgent.cwdMode` | `auto` | Working-directory policy: `auto`, `workspaceRoot`, or `prompt`. |
| `piAgent.launchMode` | `loginShell` | Use a login shell on Unix (direct launch on Windows) or the configured terminal profile. |
| `piAgent.titleMaxLength` | `24` | Session-title limit from 8 to 80 characters on macOS and Linux. |

By default, a chat uses the relevant workspace folder, or the extension host's
home directory when no workspace is open.

Settings appear under **Pi Coding Agent**.

## Platform support

- **macOS and Linux:** Full support with Python 3 and the standard Unix `pty`
  module.
- **Windows:** Launching, group reuse, and context-menu insertion. Unix PTY
  title and modifier-drop integration is unavailable. Profile mode leaves the
  terminal's own shell open after Pi exits.
- **Remote environments:** Supported when Pi and Python are installed in the
  remote extension host.
- **Browser-only VS Code:** Unsupported without a remote extension host.

If the optional Unix PTY adapter is unavailable, launching and context-menu
insertion continue to work.

Reloading the window closes Pi tabs. The extension does not adopt terminals
from a previous session. Start **Pi: Open Agent** again after a reload. Pi's
own session history, when you use it, stays inside Pi.

## Troubleshooting

**Pi was not found.** Install Pi separately and restart the window. On macOS
and Linux the default launch mode runs a non-interactive login shell
(`zsh -l` or `bash -l`), which reads `.zprofile` or `.profile` and does not
read `.zshrc` or `.bashrc`. Put Pi on that PATH, or set `piAgent.command` to
the full executable path. On Windows, an npm global install is `pi.cmd`. The extension starts that
script with `cmd.exe /d /c` and escapes `%` in arguments. A `pi.exe` on
`PATH` is launched directly.

**Session titles stay on "Pi Coding Agent".** macOS and Linux need Python 3
with the standard `pty` module on `PATH`, or `PYTHON3` set to that executable.
Windows always uses the fixed title. A newly installed Python is picked up
after the window reloads.

**Insert into Chat says nothing was selected.** Choose a file or folder in
the Explorer, or open a file, and run the command again. If no Pi chat is
open, the command creates one and then inserts the path.

## Security and privacy

Pi has filesystem and process access. Use it only in trusted workspaces. This
extension does not support untrusted or virtual workspaces and contains no
telemetry, analytics, network client, or credential storage.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Development

```bash
npm ci
npm run check
npm run package
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for project guidance.

## License and attribution

This extension is licensed under the [MIT License](LICENSE). Pi Coding Agent is
a separate project available from [pi.dev](https://pi.dev). Asset and trademark
attribution is documented in [NOTICE](NOTICE).
