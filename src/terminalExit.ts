import { EXTENSION_NAME } from "./constants";

/** Clean exits and signal-less closes are removed. Failures stay visible. */
export function shouldDisposeExitedTerminal(
  exitCode: number | undefined,
): boolean {
  return exitCode === undefined || exitCode === 0;
}

/**
 * Command-not-found codes are always reported. Other failures are reported
 * only when the process dies during startup, so a later Ctrl+C stays quiet.
 */
export function shouldNotifyTerminalFailure(
  exitCode: number,
  ageMilliseconds: number,
): boolean {
  if (exitCode === 127 || exitCode === 9009) {
    return true;
  }
  return ageMilliseconds >= 0 && ageMilliseconds < 5_000;
}

export function terminalFailureMessage(exitCode: number): string {
  return (
    `${EXTENSION_NAME} exited with code ${exitCode}. The terminal was left open so the error remains visible. ` +
    "If Pi is not installed or not on the PATH used to launch it, install Pi separately or set piAgent.command to the full executable path."
  );
}
