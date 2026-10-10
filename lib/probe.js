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
  const timeout = Number(raw.timeoutSeconds);
  return {
    item: {
      id,
      command,
      cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : "${workspaceFolder}",
      intervalSeconds: Number.isFinite(interval) && interval > 0 ? Math.max(10, interval) : 300,
      timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 60,
      alignment: raw.alignment === "right" ? "right" : "left",
      priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0
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

module.exports = { normalizeItem, resolveVariables, isOpenableUrl, interpretRun };
