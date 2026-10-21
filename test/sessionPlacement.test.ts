import assert from "node:assert/strict";
import test from "node:test";
import { columnForUnplacedTerminal } from "../src/sessionPlacement";

test("one new terminal tab binds the single unplaced chat", () => {
  assert.equal(columnForUnplacedTerminal([2], 1, -2), 2);
});

test("ambiguous or already-placed chats are left unchanged", () => {
  assert.equal(columnForUnplacedTerminal([2], 0, -2), undefined);
  assert.equal(columnForUnplacedTerminal([2, 3], 1, -2), undefined);
  assert.equal(columnForUnplacedTerminal([-2], 1, -2), undefined);
  assert.equal(columnForUnplacedTerminal([2], 2, -2), undefined);
});
