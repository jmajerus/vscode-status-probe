"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeItem,
  resolveVariables,
  interpretRun,
  takeLines,
  nextRestartDelay,
  taskMatches
} = require("../lib/probe");

test("normalizeItem fills defaults and rejects incomplete items", () => {
  const { item } = normalizeItem({ id: "a", command: "echo hi" }, 0);
  assert.deepEqual(item, {
    id: "a",
    command: "echo hi",
    watch: false,
    cwd: "${workspaceFolder}",
    intervalSeconds: 300,
    timeoutSeconds: 60,
    alignment: "left",
    priority: 0,
    refreshOnTasks: [],
    showTaskProgress: true
  });
  assert.equal(normalizeItem({ id: "a", command: "x", intervalSeconds: 1 }, 0).item.intervalSeconds, 10);
  assert.match(normalizeItem({ command: "x" }, 2).problem, /items\[2\] needs an id/);
  assert.match(normalizeItem({ id: "b" }, 0).problem, /"b" needs a command/);
});

test("resolveVariables substitutes workspace and home", () => {
  assert.equal(
    resolveVariables("node ${workspaceFolder}/s.js ${userHome}", { workspaceFolder: "/w", userHome: "/h" }),
    "node /w/s.js /h"
  );
});

test("interpretRun reads the last stdout line as JSON", () => {
  const shown = interpretRun({
    id: "srv",
    exitCode: 0,
    stdout: "noise\n{\"text\":\"$(server) main ↓3\",\"tooltip\":\"**x**\",\"level\":\"warn\",\"open\":\"http://h:1/admin\"}\n"
  });
  assert.deepEqual(shown, {
    text: "$(server) main ↓3",
    tooltip: "**x**",
    markdown: true,
    level: "warn",
    open: "http://h:1/admin"
  });
});

test("interpretRun drops unknown levels and non-http links", () => {
  const shown = interpretRun({
    id: "srv",
    exitCode: 0,
    stdout: "{\"text\":\"t\",\"level\":\"purple\",\"open\":\"command:workbench.action.terminal.new\"}"
  });
  assert.equal(shown.level, "ok");
  assert.equal(shown.open, null);
});

test("interpretRun falls back to plain text and errors", () => {
  assert.deepEqual(interpretRun({ id: "c", exitCode: 0, stdout: "12:30\n" }), {
    text: "12:30", tooltip: "12:30", markdown: false, level: "ok", open: null
  });
  const failed = interpretRun({ id: "c", exitCode: 2, stdout: "", stderr: "boom" });
  assert.equal(failed.level, "error");
  assert.equal(failed.text, "$(error) c");
  assert.equal(failed.tooltip, "c: boom");
  assert.equal(interpretRun({ id: "c", exitCode: 1, errorMessage: "timed out after 5s" }).tooltip, "c: timed out after 5s");
});

test("takeLines keeps a partial line for the next chunk", () => {
  const first = takeLines("", "{\"text\":\"a\"}\n{\"te");
  assert.deepEqual(first, { lines: ["{\"text\":\"a\"}"], rest: "{\"te" });
  assert.deepEqual(takeLines(first.rest, "xt\":\"b\"}\r\n"), { lines: ["{\"text\":\"b\"}"], rest: "" });
});

test("nextRestartDelay backs off and resets after a long run", () => {
  assert.equal(nextRestartDelay(0, 10), 2000);
  assert.equal(nextRestartDelay(2000, 10), 4000);
  assert.equal(nextRestartDelay(40000, 10), 60000);
  assert.equal(nextRestartDelay(60000, 61000), 2000);
});

test("taskMatches takes exact labels and trailing-* prefixes", () => {
  const patterns = ["Build", "Deploy staging*"];
  assert.equal(taskMatches(patterns, "Build"), true);
  assert.equal(taskMatches(patterns, "Build all"), false);
  assert.equal(taskMatches(patterns, "Deploy staging"), true);
  assert.equal(taskMatches(patterns, "Deploy staging: main"), true);
  assert.equal(taskMatches(patterns, "Deploy prod"), false);
  assert.equal(taskMatches(patterns, undefined), false);
  assert.deepEqual(normalizeItem({ id: "a", command: "x", refreshOnTasks: ["  T  ", "", 3] }, 0).item.refreshOnTasks, ["T"]);
  assert.equal(normalizeItem({ id: "a", command: "x", showTaskProgress: false }, 0).item.showTaskProgress, false);
});
