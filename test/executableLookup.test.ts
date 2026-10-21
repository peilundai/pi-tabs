import assert from "node:assert/strict";
import test from "node:test";
import {
  assessExecutable,
  executableCandidates,
  firstExistingExecutable,
  isExplicitPath,
  missingExecutableMessage,
} from "../src/executableLookup";

test("explicit paths are not looked up on PATH", () => {
  assert.equal(isExplicitPath("/usr/local/bin/pi", "linux"), true);
  assert.equal(isExplicitPath("pi", "linux"), false);
  assert.equal(isExplicitPath("C:\\Tools\\pi.cmd", "win32"), true);
  assert.deepEqual(
    executableCandidates("/opt/pi", "linux", { PATH: "/usr/bin" }),
    ["/opt/pi"],
  );
});

test("Windows lookup appends PATHEXT and skips empty PATH entries", () => {
  assert.deepEqual(
    executableCandidates("pi", "win32", {
      Path: "C:\\Windows;C:\\npm;",
      PATHEXT: ".EXE;.CMD",
    }),
    [
      "C:\\Windows\\pi.EXE",
      "C:\\Windows\\pi.CMD",
      "C:\\Windows\\pi",
      "C:\\npm\\pi.EXE",
      "C:\\npm\\pi.CMD",
      "C:\\npm\\pi",
    ],
  );
});

test("a bare command found on the extension-host PATH is available", () => {
  assert.equal(
    assessExecutable("pi", "linux", { PATH: "/usr/bin" }, "loginShell", {
      exists: (candidate) => candidate === "/usr/bin/pi",
      run: () => {
        throw new Error("login shell should not run");
      },
    }),
    "available",
  );
});

test("login-shell lookup quotes the command and accepts command -v", () => {
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  assert.equal(
    assessExecutable("pi;touch owned", "darwin", { PATH: "" }, "loginShell", {
      exists: () => false,
      run: (executable, args) => {
        calls.push({ executable, args });
        return { status: 0, stdout: "/Users/me/.local/bin/pi;touch owned\n" };
      },
    }),
    "available",
  );
  assert.deepEqual(calls, [
    {
      executable: "/bin/zsh",
      args: ["-l", "-c", "command -v 'pi;touch owned'"],
    },
  ]);
});

test("a missing login-shell command is reported without launching", () => {
  assert.equal(
    assessExecutable("pi", "linux", { SHELL: "/bin/bash", PATH: "/usr/bin" }, "loginShell", {
      exists: () => false,
      run: () => ({ status: 1, stdout: "" }),
    }),
    "missing",
  );
  assert.match(missingExecutableMessage("pi", "linux"), /npm install -g/);
  assert.doesNotMatch(
    missingExecutableMessage("/opt/missing/pi", "linux"),
    /\/opt\/missing\/pi/,
  );
});

test("profile mode does not treat a host PATH miss as definitive", () => {
  assert.equal(
    assessExecutable("pi", "linux", { PATH: "/usr/bin" }, "profile", {
      exists: () => false,
      run: () => {
        throw new Error("profile mode should not probe a login shell");
      },
    }),
    "unverified",
  );
});

test("a timed-out login shell stays unverified", () => {
  assert.equal(
    assessExecutable("pi", "linux", { PATH: "" }, "loginShell", {
      exists: () => false,
      run: () => ({ status: null }),
    }),
    "unverified",
  );
});

test("Windows lookup prefers a cmd shim over an extension-less name", () => {
  assert.equal(
    firstExistingExecutable(
      "pi",
      "win32",
      { PATH: "C:\\npm", PATHEXT: ".EXE;.CMD" },
      (candidate) => candidate.endsWith("\\pi.CMD") || candidate.endsWith("\\pi"),
    ),
    "C:\\npm\\pi.CMD",
  );
});

test("Windows direct launch treats a PATH miss as missing", () => {
  assert.equal(
    assessExecutable("pi", "win32", { PATH: "C:\\npm", PATHEXT: ".CMD" }, "loginShell", {
      exists: () => false,
      run: () => {
        throw new Error("Windows direct launch should not use a shell");
      },
    }),
    "missing",
  );
});
