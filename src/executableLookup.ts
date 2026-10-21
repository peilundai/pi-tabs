import * as path from "node:path";
import { EXTENSION_NAME } from "./constants";
import { quotePosix } from "./launch";
import type { LaunchMode } from "./types";

export type ExecutableAvailability = "available" | "missing" | "unverified";

export interface ExecutableProbeResult {
  status: number | null;
  stdout?: string | Buffer;
}

export interface ExecutableProbe {
  exists(filePath: string): boolean;
  run(
    executable: string,
    args: readonly string[],
    timeoutMilliseconds: number,
  ): ExecutableProbeResult;
}

const LOGIN_SHELL_PROBE_TIMEOUT_MS = 4_000;
const WINDOWS_PATH_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

export function isExplicitPath(
  command: string,
  platform: NodeJS.Platform,
): boolean {
  if (platform === "win32") {
    return path.win32.isAbsolute(command) || /[\\/]/.test(command);
  }
  return command.includes("/");
}

/**
 * Resolves one configured executable name to concrete files to stat.
 * Empty PATH entries are skipped so the current directory is not searched.
 */
export function firstExistingExecutable(
  command: string,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
  exists: (filePath: string) => boolean,
): string | undefined {
  return executableCandidates(command.trim() || "pi", platform, environment).find(
    (candidate) => exists(candidate),
  );
}

export function executableCandidates(
  command: string,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
): readonly string[] {
  if (isExplicitPath(command, platform)) {
    return withWindowsExtensions(command, platform, environment);
  }
  const delimiter = platform === "win32" ? ";" : ":";
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const names = withWindowsExtensions(command, platform, environment);
  const candidates: string[] = [];
  for (const directory of readPath(platform, environment).split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const name of names) {
      candidates.push(join(directory, name));
    }
  }
  return candidates;
}

/**
 * Decides whether a configured Pi command can be launched.
 * An explicit path or a Windows direct launch is authoritative.
 * A macOS/Linux login shell is checked with the extension-host PATH first,
 * then with `command -v` in that same login shell, because profile startup
 * files can add Pi to PATH. Profile mode stays unverified when the host
 * PATH misses, since the terminal profile may differ.
 */
export function assessExecutable(
  command: string,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
  launchMode: LaunchMode,
  probe: ExecutableProbe,
): ExecutableAvailability {
  const trimmed = command.trim() || "pi";
  const explicit = isExplicitPath(trimmed, platform);
  const foundOnPath = executableCandidates(trimmed, platform, environment).some(
    (candidate) => probe.exists(candidate),
  );
  if (foundOnPath) {
    return "available";
  }
  if (explicit || (platform === "win32" && launchMode === "loginShell")) {
    return "missing";
  }
  if (platform === "win32" || launchMode === "profile") {
    return "unverified";
  }

  const shell =
    environment.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  try {
    const result = probe.run(
      shell,
      ["-l", "-c", `command -v ${quotePosix(trimmed)}`],
      LOGIN_SHELL_PROBE_TIMEOUT_MS,
    );
    if (result.status === null) {
      return "unverified";
    }
    const stdout =
      typeof result.stdout === "string"
        ? result.stdout
        : result.stdout
          ? result.stdout.toString("utf8")
          : "";
    return result.status === 0 && stdout.trim() ? "available" : "missing";
  } catch {
    return "unverified";
  }
}

export function missingExecutableMessage(
  command: string,
  platform: NodeJS.Platform,
): string {
  if (isExplicitPath(command.trim() || "pi", platform)) {
    return `${EXTENSION_NAME} could not find the configured executable. Update piAgent.command to an existing Pi executable.`;
  }
  const name = command.trim() || "pi";
  return (
    `${EXTENSION_NAME} could not find "${name}". Install Pi separately ` +
    "with npm install -g @earendil-works/pi-coding-agent, then reload the window. " +
    "On macOS and Linux the command must be visible to a non-interactive login shell. " +
    "You can also set piAgent.command to the full executable path."
  );
}

function withWindowsExtensions(
  command: string,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
): readonly string[] {
  if (platform !== "win32" || path.win32.extname(command)) {
    return [command];
  }
  // Extensions come first so `pi.cmd` is chosen ahead of an extension-less
  // shell script named `pi`.
  return [...windowsExtensions(environment).map((ext) => command + ext), command];
}

function windowsExtensions(environment: NodeJS.Dict<string>): readonly string[] {
  const raw = environment.PATHEXT ?? environment.Pathext;
  const extensions = (raw ?? WINDOWS_PATH_EXTENSIONS.join(";"))
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean);
  return extensions.length > 0 ? extensions : WINDOWS_PATH_EXTENSIONS;
}

function readPath(
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
): string {
  if (platform === "win32") {
    return environment.PATH ?? environment.Path ?? environment.path ?? "";
  }
  return environment.PATH ?? "";
}
