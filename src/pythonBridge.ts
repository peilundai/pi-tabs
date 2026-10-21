import { executableCandidates } from "./executableLookup";
import type { LaunchPlan } from "./types";

const COMMON_PYTHON_LOCATIONS = [
  "/usr/bin/python3",
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
] as const;

/** Python 2 has a `pty` module, but the bridge requires Python 3. */
const PYTHON3_PROBE =
  "import sys,fcntl,pty,select,termios,tty; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)";
const MAX_PYTHON_PROBES = 8;

export interface PythonProbe {
  platform: NodeJS.Platform;
  environment: NodeJS.Dict<string>;
  exists(filePath: string): boolean;
  run(
    executable: string,
    args: readonly string[],
    timeoutMilliseconds: number,
  ): { status: number | null };
}

export interface BridgeLaunch {
  executable: string;
  bridgeArgs: readonly string[];
  childCommand: readonly string[];
}

export function locatePythonWithPty(probe: PythonProbe): string | undefined {
  if (probe.platform === "win32") {
    return undefined;
  }

  let attempts = 0;
  for (const candidate of pythonExecutableCandidates(
    probe.platform,
    probe.environment,
  )) {
    if (!probe.exists(candidate)) {
      continue;
    }
    if (attempts >= MAX_PYTHON_PROBES) {
      break;
    }
    attempts += 1;
    try {
      const result = probe.run(candidate, ["-c", PYTHON3_PROBE], 2_500);
      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Continue through the bounded candidate list.
    }
  }
  return undefined;
}

export function pythonExecutableCandidates(
  platform: NodeJS.Platform,
  environment: NodeJS.Dict<string>,
): readonly string[] {
  const configured = [environment.PYTHON3, environment.PYTHON].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const expanded = configured.flatMap((value) =>
    executableCandidates(value.trim(), platform, environment),
  );
  return [
    ...new Set([
      ...expanded,
      ...COMMON_PYTHON_LOCATIONS,
      ...executableCandidates("python3", platform, environment),
    ]),
  ];
}

export function buildBridgeLaunch(
  launch: LaunchPlan,
  options: {
    python: string;
    bridgeScript: string;
    cwd?: string;
    titleMaxLength: number;
  },
): BridgeLaunch | undefined {
  if (launch.kind !== "loginShell") {
    return undefined;
  }
  const bridgeArgs = [
    "-u",
    options.bridgeScript,
    "--title-max-length",
    String(options.titleMaxLength),
  ];
  if (options.cwd) {
    bridgeArgs.push("--cwd", options.cwd);
  }
  return {
    executable: options.python,
    bridgeArgs,
    childCommand: [launch.executable, ...launch.args],
  };
}

export function wrapProfileWithBridge(
  commandLine: string,
  options: {
    python: string;
    bridgeScript: string;
    shell: string;
    cwd?: string;
    titleMaxLength: number;
  },
): string {
  const parts = [
    quoteShell(options.python),
    "-u",
    quoteShell(options.bridgeScript),
    "--title-max-length",
    String(options.titleMaxLength),
  ];
  if (options.cwd) {
    parts.push("--cwd", quoteShell(options.cwd));
  }
  parts.push(
    "--",
    quoteShell(options.shell),
    "-c",
    quoteShell(`exec ${commandLine}`),
  );
  return `exec ${parts.join(" ")}`;
}

function quoteShell(value: string): string {
  return value ? `'${value.replaceAll("'", `'\\''`)}'` : "''";
}

