# Security policy

## Supported versions

Security fixes are applied to the latest released version. Users should update
before reporting behavior that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's private security
advisory flow for `peilundai/pi-tabs` and include:

- affected extension and editor versions;
- operating system and local or remote extension-host details;
- a minimal reproduction;
- expected impact and whether user interaction is required.

Do not include live credentials, private source code, or model-provider tokens.

## Scope and trust model

This extension launches the separately installed Pi executable with the
configured arguments and selected working directory. Pi's own code execution,
provider communication, authentication, and workspace modifications are outside
this extension's security boundary.

Relevant extension-controlled surfaces are command construction, terminal
lifecycle, path insertion, editor-tab movement, the bundled Unix PTY adapter,
and published-package contents. The extension intentionally does not operate in
untrusted or virtual workspaces.

A missing Pi executable is detected before launch. Explicit paths are stat'ed.
Windows direct launch searches `PATH` and `PATHEXT` and skips empty `PATH`
entries. `.exe` and `.com` files are launched directly. An npm `pi.cmd` or
`pi.bat` shim is started with `cmd.exe /d /c` because a bare name would not
resolve to that script. Percent signs in that shim path and in arguments are
doubled so cmd does not expand environment variables, and unquoted
metacharacters are caret-escaped. On macOS and Linux login-shell mode, a bare
command that is not already on the extension-host `PATH` is checked with
`command -v` of that single quoted word in the same login shell used to start
Pi. The lookup does not concatenate the configured command into a shell
script. The output channel does not record the working directory or a
resolved executable path.

