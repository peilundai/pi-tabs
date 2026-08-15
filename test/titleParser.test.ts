import assert from "node:assert/strict";
import test from "node:test";
import {
  compactTitle,
  consumeOscTitles,
  titleFromPiOsc,
} from "../src/titleParser";

test("Pi titles normalize and compact the session portion", () => {
  assert.equal(
    titleFromPiOsc("π - Refactor the authentication middleware - app", 24),
    "Refactor the authentica…",
  );
  assert.equal(titleFromPiOsc("π - app"), "Pi Coding Agent");
  assert.equal(titleFromPiOsc("zsh"), undefined);
  assert.equal(compactTitle("  one   two  "), "one two");
});

test("OSC extraction handles BEL, ST, and split chunks", () => {
  const first = consumeOscTitles("text\u001b]0;π - hello - app");
  assert.deepEqual(first.payloads, []);
  const second = consumeOscTitles("\u0007more\u001b]2;zsh\u001b\\", first.carry);
  assert.deepEqual(second.payloads, ["π - hello - app", "zsh"]);
  assert.equal(second.carry, "");
});

