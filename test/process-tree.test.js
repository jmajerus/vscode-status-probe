"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const { stopProcessTree, watchSpawnOptions } = require("../lib/process-tree");

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function waitFor(predicate, label, timeoutMs = 10000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test("stopProcessTree uses the process group on POSIX and taskkill on Windows", () => {
  const calls = [];
  const child = { pid: 42, kill: () => calls.push(["child.kill"]) };
  stopProcessTree(child, { platform: "linux", kill: (pid, signal) => calls.push(["kill", pid, signal]) });
  stopProcessTree(child, {
    platform: "win32",
    run: (command, args) => {
      calls.push([command, ...args]);
      return { on() {} };
    }
  });
  assert.deepEqual(calls, [
    ["kill", -42, "SIGTERM"],
    ["taskkill", "/pid", "42", "/T", "/F"]
  ]);
  assert.equal(watchSpawnOptions("/w", "win32").detached, false);
  assert.equal(watchSpawnOptions("/w", "darwin").detached, true);
});

test("stopping a watch command also stops the program it started", async () => {
  const fixture = path.join(__dirname, "..", "fixtures", "process-tree.js");
  // Through a shell, exactly as Status Probe starts a watch command.
  const child = spawn(`node "${fixture}"`, watchSpawnOptions(path.join(__dirname, "..")));
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => { output += chunk; });
  let grandchild;
  try {
    await waitFor(() => output.includes("\n"), "the fixture's first line");
    grandchild = JSON.parse(output.split("\n")[0]).grandchild;
    assert.equal(alive(grandchild), true);
    stopProcessTree(child);
    await waitFor(() => !alive(grandchild), "the grandchild to stop");
  } finally {
    if (grandchild && alive(grandchild)) process.kill(grandchild);
    if (child.exitCode === null) child.kill();
  }
});
