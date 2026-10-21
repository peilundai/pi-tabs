import type { ExtensionConfiguration, LaunchPlan } from "./types";

const POSIX_SAFE = /^[A-Za-z0-9_./:=+,-]+$/;
const WINDOWS_SAFE = /^[A-Za-z0-9_./:\\=+,-]+$/;

export function buildLaunchPlan(
  configuration: Pick<
    ExtensionConfiguration,
    "command" | "args" | "launchMode"
  >,
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string> = process.env,
): LaunchPlan {
  const command = configuration.command.trim() || "pi";
  const commandLine = buildCommandLine(command, configuration.args, platform);

  if (configuration.launchMode === "profile") {
    return { kind: "profile", commandLine };
  }

  if (platform === "win32") {
    return {
      kind: "loginShell",
      commandLine,
      executable: command,
      args: [...configuration.args],
    };
  }

  const fallbackShell = platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  return {
    kind: "loginShell",
    commandLine,
    executable: environment.SHELL || fallbackShell,
    args: ["-l", "-c", `exec ${commandLine}`],
  };
}

export function buildCommandLine(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): string {
  const quote = platform === "win32" ? quoteWindowsArgument : quotePosix;
  return [executable, ...args].map(quote).join(" ");
}

export function quotePosix(value: string): string {
  if (!value) {
    return "''";
  }
  return POSIX_SAFE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Formats one Windows argv value for the optional profile-mode command. */
export function quoteWindowsArgument(value: string): string {
  if (!value) {
    return '""';
  }
  if (WINDOWS_SAFE.test(value)) {
    return value;
  }

  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}

export function terminalEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, COLORTERM: "truecolor" };
}

/**
 * Launches a Windows `pi.cmd` / `pi.bat` npm shim. VS Code 1.85 resolves only
 * `.com` and `.exe` when `shellPath` is a bare name, so the shim would not
 * start. `cmd.exe /d /c` runs it without AutoRun. Percent signs are doubled
 * so cmd does not expand environment variables. Metacharacters are caret-escaped
 * only when the argument has no space or quote; those are quoted by the PTY.
 */
export function windowsCmdShimLaunch(
  executablePath: string,
  args: readonly string[],
  comSpec: string | undefined,
): { shellPath: string; shellArgs: readonly string[] } {
  return {
    shellPath: comSpec?.trim() || "cmd.exe",
    shellArgs: [
      "/d",
      "/c",
      escapeCmdArgument(executablePath),
      ...args.map(escapeCmdArgument),
    ],
  };
}

export function escapeCmdArgument(value: string): string {
  const percentEscaped = value.replaceAll("%", "%%");
  if (percentEscaped.length === 0 || /[\t "]/.test(percentEscaped)) {
    return percentEscaped;
  }
  return percentEscaped.replace(/[&|<>^]/g, (character) => `^${character}`);
}

export function profileExitCommand(
  commandLine: string,
  platform: NodeJS.Platform,
): string {
  // A second line would be typed into Pi after the shell starts it.
  // POSIX `exec` replaces the profile shell. On Windows the profile shell
  // stays open because cmd and PowerShell do not share an exit separator.
  return platform === "win32" ? commandLine : `exec ${commandLine}`;
}
