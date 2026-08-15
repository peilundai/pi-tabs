# Contributing

Thanks for helping improve the Pi editor workflow.

## Before opening a change

- Search existing issues and keep each change focused.
- Do not add model-provider clients, telemetry, credential handling, or Pi
  internals without prior design discussion. The extension is intentionally a
  small launcher and editor integration.
- Preserve the unofficial-project disclaimer and third-party attribution.
- Add or update tests for behavior changes.

## Local setup

```bash
npm ci
npm run check
```

Press `F5` in VS Code to open an Extension Development Host. Test both a first
chat and multiple chats in the reused editor group. On macOS or Linux, also
test session titles, terminal resizing, `/quit`, context insertion, and a
modifier-assisted file drop.

## Pull requests

A pull request should include:

- the user-visible problem and chosen behavior;
- automated tests for pure policy or parsing changes;
- manual verification steps for VS Code UI behavior;
- documentation and changelog updates when behavior changes;
- no generated `.vsix`, `.test-out`, cache, or dependency directories.

Run `npm run package` before requesting review. Inspect the resulting VSIX with
`unzip -l` and confirm that `test/`, `src/`, `.github/`, and local configuration
files are absent.

## Design principles

1. Treat commands and arguments as data, never as untrusted shell fragments.
2. Track terminal objects, not inferred process names or mutable labels.
3. Keep Pi responsible for sessions, auth, providers, and model traffic.
4. Make optional platform integration degrade to a documented core workflow.
5. Prefer pure functions with direct tests at editor API boundaries.

