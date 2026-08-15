import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommandLine,
  buildLaunchPlan,
  quotePosix,
  quoteWindowsArgument,
} from "../src/launch";

test("POSIX quoting treats command and every argument as data", () => {
  assert.equal(quotePosix("hello world"), "'hello world'");
  assert.equal(quotePosix("it's"), "'it'\\''s'");
  assert.equal(
    buildCommandLine("pi", ["--model", "provider/model name"], "darwin"),
    "pi --model 'provider/model name'",
  );
});

test("Windows quoting follows argv backslash and quote rules", () => {
  assert.equal(quoteWindowsArgument("plain"), "plain");
  assert.equal(quoteWindowsArgument("two words"), '"two words"');
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
});

test("login shell plans use platform defaults and preserve arguments", () => {
  assert.deepEqual(
    buildLaunchPlan(
      { command: "pi", args: ["--model", "x/y"], launchMode: "loginShell" },
      "darwin",
      {},
    ),
    {
      kind: "loginShell",
      commandLine: "pi --model x/y",
      executable: "/bin/zsh",
      args: ["-l", "-c", "exec pi --model x/y"],
    },
  );
});

test("profile mode returns a command without choosing a shell", () => {
  assert.deepEqual(
    buildLaunchPlan(
      { command: "pi", args: [], launchMode: "profile" },
      "linux",
      {},
    ),
    { kind: "profile", commandLine: "pi" },
  );
});

test("Windows default mode launches Pi directly without cmd.exe expansion", () => {
  assert.deepEqual(
    buildLaunchPlan(
      {
        command: "pi.exe",
        args: ["--model", "%literal%"],
        launchMode: "loginShell",
      },
      "win32",
      { ComSpec: "cmd.exe" },
    ),
    {
      kind: "loginShell",
      commandLine: 'pi.exe --model "%literal%"',
      executable: "pi.exe",
      args: ["--model", "%literal%"],
    },
  );
});
