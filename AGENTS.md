# AGENTS.md

Guidance for coding agents working in this repository. These instructions apply to the entire repository.

## Project purpose

This is a small, unofficial VS Code extension that launches a separately installed Pi Coding Agent CLI in editor-area terminal tabs. It owns editor placement, terminal lifecycle, path insertion, and an optional Unix PTY adapter. Pi owns conversations, persistence, authentication, providers, models, tools, and network traffic.

Keep that boundary narrow. Do not add model-provider clients, telemetry, credential handling, conversation storage, or Pi internals without an explicit design decision from the maintainer.

## Start here

Before substantial changes, read:

- `README.md` for user-visible behavior and platform promises
- `CONTRIBUTING.md` for contribution and manual-test expectations
- `docs/ARCHITECTURE.md` for module boundaries and invariants
- `SECURITY.md` for the trust model
- `NOTICE` before changing Pi-related names, marks, or assets
- `PUBLISHING.md` for Marketplace identity and release considerations

Treat those documents and `package.json` as part of the product contract. Update them when behavior or packaging changes.

## Repository map

- `src/`: TypeScript extension source
- `test/`: Node test-runner tests, primarily for pure policy and parsing logic
- `scripts/pi-pty-bridge.py`: dependency-free Unix PTY bridge
- `media/`: extension and command icons
- `out/`: generated TypeScript output; do not edit by hand
- `.test-out/`: generated test output; do not edit or commit
- `.vscodeignore`: controls published VSIX contents

`src/piTerminalManager.ts` is the stateful coordinator. Prefer keeping validation, parsing, quoting, and policy in small pure modules rather than adding more state to the manager.

## Required workflow

Install exactly from the lockfile:

```bash
npm ci
```

Run the complete validation suite after code or manifest changes:

```bash
npm run check
```

This runs ESLint, compiles and executes tests, and compiles the extension. Before a release or packaging-related change, also run:

```bash
npm run package
npx vsce ls --no-dependencies
```

Inspect the VSIX when package contents matter:

```bash
unzip -l pi-agent-launcher-*.vsix
```

Do not commit `node_modules/`, `out/`, `.test-out/`, `*.vsix`, logs, caches, or editor-local files.

## Coding conventions

- TypeScript is strict and targets ES2022/CommonJS.
- Follow the existing style: two-space indentation, semicolons, double quotes, and trailing commas where appropriate.
- Prefer explicit types at external boundaries and immutable plans from pure functions.
- Keep modules focused on the responsibilities documented in `docs/ARCHITECTURE.md`.
- Avoid new runtime dependencies. The published extension currently has none.
- Do not weaken compiler or lint rules to accommodate a change.
- Use VS Code APIs from the supported baseline declared in `engines.vscode`.
- Modify source files, then compile; never patch generated `out/*.js` or source maps directly.

## Security invariants

Preserve these unless the maintainer explicitly approves a redesign:

1. Treat `piAgent.command` as one executable name or path and `piAgent.args` as argument values—not shell syntax.
2. Never concatenate untrusted values into shell fragments. Preserve the platform-specific quoting and direct Windows launch behavior.
3. Identify managed sessions by concrete `vscode.Terminal` objects, not titles, process names, or mutable labels.
4. Manage only terminals created during the current extension-host lifetime; do not adopt unrelated terminals after reload.
5. Rewrite terminal input only when the complete input satisfies the existing verified-path rules.
6. Keep OSC parsing bounded and tolerant of split input.
7. Preserve graceful fallback to a native VS Code terminal when Python or Unix PTY support is unavailable.
8. Do not add telemetry, analytics, credential storage, prompt capture, or model-traffic proxying.
9. Keep untrusted and virtual workspaces unsupported unless a full security review accompanies the change.
10. Never log credentials, prompts, private file contents, or unnecessary absolute paths.

Changes to command construction, terminal input, PTY relay, path handling, or workspace trust are security-sensitive and require focused regression tests.

## Testing expectations

- Add or update tests for every behavior change that can be expressed without a live VS Code host.
- Prefer extracting pure functions at VS Code API boundaries rather than relying only on manual testing.
- Keep tests deterministic and dependency-free using `node:test` and `node:assert/strict`.
- Python bridge changes must cover relay lifecycle, resizing, title rewriting, path rewriting, and partial I/O as applicable.
- Manifest changes should update `test/package.test.ts` when they alter publication or command invariants.

For UI or terminal behavior, use `F5` to launch an Extension Development Host and manually verify relevant cases. Depending on the change, cover:

- first chat and multiple independent chats in the reused editor group;
- active-terminal and editor-column tracking;
- context-menu path insertion and editor-tab movement;
- paths containing spaces and paths outside the workspace;
- `/quit`, terminal disposal, resizing, and session titles;
- missing Pi, missing Python, and native-terminal fallback;
- local, multi-root, remote, macOS/Linux, and Windows behavior when affected.

Document manual verification in the final summary or pull request.

## Documentation and user-facing changes

For user-visible behavior:

- update `README.md` and relevant settings/command descriptions;
- add an entry under `CHANGELOG.md` → `Unreleased`;
- update `docs/ARCHITECTURE.md` if responsibilities or runtime flow change;
- update `SECURITY.md` if the trust boundary changes.

Use “Pi Coding Agent” consistently. Preserve the conspicuous statement that this project is unofficial and requires Pi to be installed and configured separately.

Do not remove or dilute `NOTICE` attribution. The Pi name and geometric mark may carry trademark obligations beyond their source license. Do not introduce new Pi-derived branding or imply endorsement without maintainer approval.

## Manifest and packaging rules

When editing `package.json`:

- keep command contributions and `activationEvents` synchronized;
- preserve the extension’s source, license, support, pricing, and workspace-capability metadata;
- keep `publisher` and `name` stable unless intentionally creating a new Marketplace identity;
- bump `version` only as part of an intentional release;
- verify all repository, homepage, issue, and changelog URLs are real before publishing.

The VSIX should contain only runtime JS, runtime assets, the Python bridge, and user-facing legal/support documentation. Source, tests, CI files, source maps, local configuration, dependency directories, and prior VSIX files must remain excluded.

The package icon must be PNG; user-provided SVG content and untrusted image URLs can violate Marketplace publishing constraints.

## Commit conventions

Create commits only when the maintainer explicitly requests them. Use Conventional Commits:

```text
<type>[optional scope]: <imperative summary>
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, and `chore`. Keep the subject concise, lowercase after the colon, and focused on one logical change. Add `!` and a `BREAKING CHANGE:` footer when applicable.

Examples:

```text
feat(terminal): preserve active chat across editor moves
fix(launch): quote configured executable paths on POSIX
docs: clarify Marketplace publishing prerequisites
```

Use a commit body only when it adds useful context. Focus the body on **why** the change was needed and **how** the chosen approach addresses the problem, including important tradeoffs or constraints. Do not repeat a file-by-file description of what changed; the diff already provides that.

## Scope discipline

Keep changes focused. Avoid opportunistic refactors, formatting churn, generated-file edits, or unrelated dependency upgrades. If a request conflicts with the architecture or security invariants, explain the conflict and propose the smallest safe alternative.

In the final response, summarize:

- files changed;
- behavior and important design choices;
- validation commands run and their results;
- manual testing not performed or remaining risks.
