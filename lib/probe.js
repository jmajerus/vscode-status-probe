"use strict";

// Pure helpers, no `vscode` import, so `node --test` can cover them.

const LEVELS = new Set(["ok", "warn", "error"]);
const MAX_TEXT = 80;

/**
 * Normalize one configured item, or return null with a reason.
 * @returns {{ item: object | null, problem: string | null }}
 */
function normalizeItem(raw, index) {
  if (!raw || typeof raw !== "object") {
    return { item: null, problem: `statusProbe.items[${index}] is not an object` };
  }
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  const command = typeof raw.command === "string" && raw.command.trim() ? raw.command.trim() : null;
  if (!id) return { item: null, problem: `statusProbe.items[${index}] needs an id` };
  if (!command) return { item: null, problem: `statusProbe item "${id}" needs a command` };
  const interval = Number(raw.intervalSeconds);
  const watch = raw.watch === true;
  const timeout = Number(raw.timeoutSeconds);
  const refreshOnTasks = (Array.isArray(raw.refreshOnTasks) ? raw.refreshOnTasks : [])
    .filter(name => typeof name === "string" && name.trim())
    .map(name => name.trim());
  return {
    item: {
      id,
      command,
      watch,
      cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : "${workspaceFolder}",
      // 0 means no timer: run at startup, on click, and after linked tasks.
      intervalSeconds: raw.intervalSeconds === 0
        ? 0
        : Number.isFinite(interval) && interval > 0 ? Math.max(10, interval) : 300,
      timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 60,
      alignment: raw.alignment === "right" ? "right" : "left",
      priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
      refreshOnTasks,
      showTaskProgress: raw.showTaskProgress !== false
    },
    problem: null
  };
}

function resolveVariables(value, { workspaceFolder = "", userHome = "" } = {}) {
  return String(value)
    .replace(/\$\{workspaceFolder\}/g, workspaceFolder)
    .replace(/\$\{userHome\}/g, userHome);
}

function isOpenableUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function clip(text) {
  const single = String(text).replace(/\s+/g, " ").trim();
  return single.length > MAX_TEXT ? `${single.slice(0, MAX_TEXT - 1)}…` : single;
}

/**
 * Whether a task name matches one of an item's `refreshOnTasks` patterns:
 * an exact label, or a prefix ending in `*` (`"Deploy staging*"`).
 */
function taskMatches(patterns, name) {
  if (typeof name !== "string") return false;
  return patterns.some(pattern => pattern.endsWith("*")
    ? name.startsWith(pattern.slice(0, -1))
    : name === pattern);
}

/**
 * Split streamed stdout into complete lines, keeping the unfinished tail.
 * @returns {{ lines: string[], rest: string }}
 */
function takeLines(buffer, chunk) {
  const parts = (buffer + chunk).split(/\r?\n/);
  const rest = parts.pop();
  return { lines: parts.map(line => line.trim()).filter(Boolean), rest };
}

/**
 * Delay before restarting a watch command that exited: doubles from 2 s to
 * 60 s, and starts over once a run has lasted a minute.
 */
function nextRestartDelay(previousMs, ranMs) {
  if (ranMs >= 60000 || !previousMs) return 2000;
  return Math.min(previousMs * 2, 60000);
}

/**
 * Turn a finished command into what the status bar shows.
 *
 * The command's last non-empty stdout line is read as JSON
 * `{ text, tooltip?, level?, open? }`. Any other output is shown as plain
 * text: the first line, `ok` on exit 0 and `error` otherwise.
 *
 * @returns {{ text: string, tooltip: string, markdown: boolean, level: "ok" | "warn" | "error", open: string | null }}
 */
function interpretRun({ id, exitCode, stdout = "", stderr = "", errorMessage = null }) {
  const lines = String(stdout).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (last && last.startsWith("{")) {
    try {
      const payload = JSON.parse(last);
      if (payload && typeof payload.text === "string" && payload.text.trim()) {
        return {
          text: clip(payload.text),
          tooltip: typeof payload.tooltip === "string" ? payload.tooltip : "",
          markdown: true,
          level: LEVELS.has(payload.level) ? payload.level : "ok",
          open: isOpenableUrl(payload.open) ? payload.open : null
        };
      }
    } catch {
      // Not JSON after all; fall through to plain text.
    }
  }
  if (exitCode === 0 && lines.length) {
    return { text: clip(lines[0]), tooltip: lines.join("\n"), markdown: false, level: "ok", open: null };
  }
  const detail = errorMessage || String(stderr).trim() || lines.join("\n") || `exited with ${exitCode}`;
  return {
    text: `$(error) ${clip(id)}`,
    tooltip: `${id}: ${detail}`,
    markdown: false,
    level: "error",
    open: null
  };
}

module.exports = {
  normalizeItem,
  resolveVariables,
  isOpenableUrl,
  interpretRun,
  takeLines,
  nextRestartDelay,
  taskMatches
};
