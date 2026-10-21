import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldDisposeExitedTerminal,
  shouldNotifyTerminalFailure,
  terminalFailureMessage,
} from "../src/terminalExit";

test("clean exits are closed and failures stay open", () => {
  assert.equal(shouldDisposeExitedTerminal(0), true);
  assert.equal(shouldDisposeExitedTerminal(undefined), true);
  assert.equal(shouldDisposeExitedTerminal(127), false);
  assert.equal(shouldDisposeExitedTerminal(1), false);
});

test("startup failures and command-not-found codes notify the user", () => {
  assert.equal(shouldNotifyTerminalFailure(127, 60_000), true);
  assert.equal(shouldNotifyTerminalFailure(9009, 60_000), true);
  assert.equal(shouldNotifyTerminalFailure(1, 500), true);
  assert.equal(shouldNotifyTerminalFailure(130, 60_000), false);
  assert.match(terminalFailureMessage(127), /left open/);
});
