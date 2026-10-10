"use strict";

// Starting and stopping a watch command together with everything it starts.
// A watch command runs through a shell, which then starts the real program
// (often a `node` listener). Killing only the shell would leave that
// program running after every refresh or window reload.

const { spawn } = require("node:child_process");

/** spawn() options for a watch command on this platform. */
function watchSpawnOptions(cwd, platform = process.platform) {
  return {
    shell: true,
    cwd,
    // POSIX: its own process group, so one signal reaches the whole tree.
    detached: platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  };
}

/**
 * Stop a child started with watchSpawnOptions and everything under it.
 * POSIX signals the process group; Windows has no groups to signal, so
 * taskkill walks the tree (/T) and forces each process down (/F).
 */
function stopProcessTree(child, {
  platform = process.platform,
  run = spawn,
  kill = process.kill.bind(process)
} = {}) {
  if (!child || !Number.isInteger(child.pid)) return;
  try {
    if (platform === "win32") {
      const killer = run("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("error", () => child.kill());
    } else {
      kill(-child.pid, "SIGTERM");
    }
  } catch {
    child.kill();
  }
}

module.exports = { watchSpawnOptions, stopProcessTree };
