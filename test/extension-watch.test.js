"use strict";

// Drives extension.js against a stand-in `vscode` module: enough to check
// that watch mode renders each streamed line, keeps the last status when the
// command exits, and restarts it.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const os = require("node:os");

const bars = [];
const commands = new Map();
const taskListeners = { start: [], end: [] };
const fakeVscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor(value) { this.value = value; } },
  Uri: { parse: value => value },
  env: { openExternal() {} },
  window: {
    createStatusBarItem() {
      const bar = { texts: [], show() {}, dispose() { this.disposed = true; } };
      Object.defineProperty(bar, "text", {
        get() { return this.texts[this.texts.length - 1]; },
        set(value) { this.texts.push(value); }
      });
      bars.push(bar);
      return bar;
    },
    createOutputChannel() { return { appendLine() {}, dispose() {} }; }
  },
  workspace: {
    isTrusted: true,
    workspaceFolders: [{ uri: { fsPath: os.tmpdir() } }],
    items: [],
    getConfiguration() { return { get: () => fakeVscode.workspace.items }; },
    onDidChangeConfiguration() { return { dispose() {} }; },
    onDidChangeWorkspaceFolders() { return { dispose() {} }; }
  },
  tasks: {
    taskExecutions: [],
    onDidStartTask(listener) {
      taskListeners.start.push(listener);
      return { dispose() {} };
    },
    onDidEndTask(listener) {
      taskListeners.end.push(listener);
      return { dispose() {} };
    }
  },
  commands: {
    registerCommand(id, handler) {
      commands.set(id, handler);
      return { dispose() {} };
    }
  }
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  return request === "vscode" ? fakeVscode : originalLoad.call(this, request, ...rest);
};

function waitFor(predicate, label, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test("watch mode renders streamed lines and restarts the command", async () => {
  const script = [
    "console.log(JSON.stringify({ text: 'one', level: 'ok' }));",
    "setTimeout(() => console.log(JSON.stringify({ text: 'two', level: 'warn', open: 'http://h/x' })), 100);",
    "setTimeout(() => process.exit(0), 200);"
  ].join(" ");
  fakeVscode.workspace.items = [{ id: "w", command: `node -e "${script}"`, watch: true }];
  const subscriptions = [];
  require("../extension").activate({ subscriptions });
  const bar = bars[bars.length - 1];
  await waitFor(() => bar.texts.includes("two"), "second line");
  assert.equal(bar.backgroundColor.id, "statusBarItem.warningBackground");
  // After exit the last status stays up, then the command runs again.
  await waitFor(() => bar.texts.filter(text => text === "one").length >= 2, "restart");
  assert.ok(!bar.texts.some(text => text.startsWith("$(error)")), "a clean exit is not an error");
  for (const subscription of subscriptions) subscription.dispose();
  assert.equal(bar.disposed, true);
});

test("linked tasks show a spinner while running and refresh the item when they end", async () => {
  taskListeners.start.length = 0;
  taskListeners.end.length = 0;
  fakeVscode.workspace.items = [{
    id: "t",
    command: "node -e \"console.log(JSON.stringify({ text: 'run ' + process.hrtime.bigint() }))\"",
    intervalSeconds: 0,
    refreshOnTasks: ["Deploy staging*"]
  }];
  const subscriptions = [];
  require("../extension").activate({ subscriptions });
  const bar = bars[bars.length - 1];
  try {
    await waitFor(() => bar.text?.startsWith("run "), "first run");
    const first = bar.text;

    const other = { task: { name: "Test" } };
    for (const listener of taskListeners.start) listener({ execution: other });
    assert.equal(bar.text, first, "an unlinked task changes nothing");

    const deploy = { task: { name: "Deploy staging: main" } };
    for (const listener of taskListeners.start) listener({ execution: deploy });
    assert.equal(bar.text, `$(sync~spin) ${first}`);
    for (const listener of taskListeners.end) listener({ execution: deploy });
    assert.equal(bar.text, first, "the spinner goes when the task ends");
    await waitFor(() => bar.text?.startsWith("run ") && bar.text !== first, "refresh after the task");
    for (const listener of taskListeners.end) listener({ execution: other });
  } finally {
    for (const subscription of subscriptions) subscription.dispose();
  }
});
