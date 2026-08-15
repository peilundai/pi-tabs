import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

interface Manifest {
  main: string;
  license: string;
  repository?: unknown;
  dependencies?: Record<string, string>;
  activationEvents?: string[];
  capabilities?: {
    untrustedWorkspaces?: { supported?: boolean };
    virtualWorkspaces?: { supported?: boolean };
  };
  contributes: {
    commands: Array<{ command: string; icon?: unknown }>;
  };
}

const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Manifest;

test("the publication manifest declares source, license, and safe workspace limits", () => {
  assert.equal(manifest.main, "./out/extension.js");
  assert.equal(manifest.license, "MIT");
  assert.ok(manifest.repository);
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
  assert.equal(manifest.capabilities?.virtualWorkspaces?.supported, false);
  assert.deepEqual(manifest.dependencies ?? {}, {});
});

test("every contributed command has a matching activation event", () => {
  const commands = manifest.contributes.commands.map((item) => item.command);
  assert.deepEqual(
    new Set(manifest.activationEvents),
    new Set(commands.map((command) => `onCommand:${command}`)),
  );
});

test("the New Chat command ships a theme-aware Pi icon", () => {
  const command = manifest.contributes.commands.find(
    (item) => item.command === "piAgent.newChat",
  );
  assert.deepEqual(command?.icon, {
    light: "media/pi-coding-agent-light.svg",
    dark: "media/pi-coding-agent-dark.svg",
  });
});
