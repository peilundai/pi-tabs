import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildBridgeLaunch,
  locatePythonWithPty,
} from "../src/pythonBridge";

const bridge = path.resolve("scripts/pi-pty-bridge.py");
const runtimePython = locatePythonWithPty({
  platform: process.platform,
  environment: process.env,
  exists: existsSync,
  run: (executable, args, timeoutMilliseconds) =>
    spawnSync(executable, [...args], { timeout: timeoutMilliseconds }),
});

test("Python discovery is disabled on Windows and bounded elsewhere", () => {
  assert.equal(
    locatePythonWithPty({
      platform: "win32",
      environment: {},
      exists: () => true,
      run: () => ({ status: 0 }),
    }),
    undefined,
  );
  assert.equal(
    locatePythonWithPty({
      platform: "darwin",
      environment: { PYTHON3: "/custom/python" },
      exists: (candidate) => candidate === "/custom/python",
      run: () => ({ status: 0 }),
    }),
    "/custom/python",
  );
});

test("bridge plans preserve the exact child executable and arguments", () => {
  assert.deepEqual(
    buildBridgeLaunch(
      {
        kind: "loginShell",
        commandLine: "pi",
        executable: "/bin/zsh",
        args: ["-l", "-c", "exec pi"],
      },
      {
        python: "/usr/bin/python3",
        bridgeScript: bridge,
        cwd: "/work",
        titleMaxLength: 24,
      },
    ),
    {
      executable: "/usr/bin/python3",
      bridgeArgs: [
        "-u",
        bridge,
        "--title-max-length",
        "24",
        "--cwd",
        "/work",
      ],
      childCommand: ["/bin/zsh", "-l", "-c", "exec pi"],
    },
  );
});

test(
  "bridge helper modes rewrite paths and Pi titles without dependencies",
  { skip: !runtimePython },
  () => {
    const input = spawnSync(
      runtimePython as string,
      [bridge, "--cwd", "/etc", "--rewrite-input-only"],
      { input: "/etc/hosts", encoding: "utf8" },
    );
    assert.equal(input.status, 0, input.stderr);
    assert.equal(input.stdout, "@hosts");

    const title = spawnSync(
      runtimePython as string,
      [bridge, "--title-max-length", "12", "--rewrite-output-only"],
      { input: "\u001b]0;π - a very long session - app\u0007", encoding: "utf8" },
    );
    assert.equal(title.status, 0, title.stderr);
    assert.equal(title.stdout, "\u001b]0;a very long…\u0007");

    const unrelatedTitle = spawnSync(
      runtimePython as string,
      [bridge, "--rewrite-output-only"],
      { input: "\u001b]0;zsh\u0007", encoding: "utf8" },
    );
    assert.equal(unrelatedTitle.status, 0, unrelatedTitle.stderr);
    assert.equal(unrelatedTitle.stdout, "");

    const relay = spawnSync(
      runtimePython as string,
      [
        bridge,
        "--columns",
        "40",
        "--rows",
        "10",
        "--",
        runtimePython as string,
        "-c",
        "import os; os.write(1, b'\\x1b]0;\\xcf\\x80 - a very long session title for test - app\\x07')",
      ],
      { input: "", encoding: "utf8" },
    );
    assert.equal(relay.status, 0, relay.stderr);
    assert.equal(relay.stdout.includes("a very long session title for test"), false);
    assert.equal(relay.stdout.includes("a very long session title for test".slice(0, 23)), true);
  },
);

test(
  "PTY relay applies per-terminal resize controls",
  { skip: !runtimePython, timeout: 5_000 },
  async () => {
    const sizeProbe = [
      "import fcntl, struct, termios, time",
      "def size(): return struct.unpack('HHHH', fcntl.ioctl(0, termios.TIOCGWINSZ, bytes(8)))[:2]",
      "print(*size(), flush=True)",
      "deadline=time.time()+2",
      "while time.time()<deadline and size() != (40,120): time.sleep(0.02)",
      "print(*size(), flush=True)",
    ].join("\n");
    const child = spawn(
      runtimePython as string,
      [
        "-u",
        bridge,
        "--columns",
        "80",
        "--rows",
        "24",
        "--control-fd",
        "3",
        "--",
        runtimePython as string,
        "-u",
        "-c",
        sizeProbe,
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (output.includes("24 80")) {
        const resizeControl = child.stdio[3];
        if (resizeControl && "write" in resizeControl) {
          resizeControl.write("120 40\n");
        }
      }
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(exitCode, 0);
    assert.match(output, /24 80/);
    assert.match(output, /40 120/);
  },
);

test(
  "PTY relay forwards terminal termination to the Pi process",
  { skip: !runtimePython, timeout: 5_000 },
  async () => {
    const signalProbe = [
      "import signal, sys, time",
      "def stop(*_):",
      " print('stopped', flush=True)",
      " sys.exit(0)",
      "signal.signal(signal.SIGTERM, stop)",
      "print('ready', flush=True)",
      "while True: time.sleep(1)",
    ].join("\n");
    const child = spawn(
      runtimePython as string,
      ["-u", bridge, "--", runtimePython as string, "-u", "-c", signalProbe],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let terminationSent = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (!terminationSent && output.includes("ready")) {
        terminationSent = true;
        child.kill("SIGTERM");
      }
    });
    const result = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null });
    assert.match(output, /stopped/);
  },
);

test(
  "PTY relay rewrites an existing dropped path before the child reads it",
  { skip: !runtimePython, timeout: 5_000 },
  () => {
    const reader = [
      "import os, termios",
      "settings=termios.tcgetattr(0)",
      "settings[3]&=~(termios.ICANON|termios.ECHO)",
      "settings[6][termios.VMIN]=1",
      "settings[6][termios.VTIME]=0",
      "termios.tcsetattr(0, termios.TCSANOW, settings)",
      "os.write(1, os.read(0, 4096))",
    ].join(";");
    const result = spawnSync(
      runtimePython as string,
      [
        "-u",
        bridge,
        "--cwd",
        "/etc",
        "--",
        runtimePython as string,
        "-c",
        reader,
      ],
      { input: "/etc/hosts", encoding: "utf8", timeout: 5_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("/etc/hosts"), false);
    assert.equal(result.stdout.includes("@hosts"), true);
  },
);
