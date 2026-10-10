"use strict";

const vscode = require("vscode");
const { exec, spawn } = require("node:child_process");
const os = require("node:os");

const {
  normalizeItem,
  resolveVariables,
  interpretRun,
  takeLines,
  nextRestartDelay,
  taskMatches
} = require("./lib/probe");

const BACKGROUND = {
  warn: "statusBarItem.warningBackground",
  error: "statusBarItem.errorBackground"
};

function commandVariables() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
  return { workspaceFolder: folder, userHome: os.homedir() };
}

/**
 * One status bar item driven by one configured command: re-run on an
 * interval, or (`watch: true`) run as an event listener, each line it
 * prints replacing what the item shows. Tasks named in `refreshOnTasks`
 * show a spinner on the item while they run and refresh it when they end.
 */
class Probe {
  constructor(item, output) {
    this.item = item;
    this.output = output;
    this.running = false;
    this.open = null;
    this.shownText = null;
    // Linked task executions still running (see refreshOnTasks).
    this.tasks = new Set();
    this.bar = vscode.window.createStatusBarItem(
      `statusProbe.${item.id}`,
      item.alignment === "right" ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left,
      item.priority
    );
    this.bar.name = `Status Probe: ${item.id}`;
    this.bar.text = `$(sync~spin) ${item.id}`;
    this.bar.command = { command: "statusProbe.click", title: "Status Probe", arguments: [item.id] };
    this.bar.show();
    if (item.watch) {
      this.startWatch();
    } else {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), item.intervalSeconds * 1000);
    }
  }

  startWatch() {
    clearTimeout(this.restartTimer);
    const variables = commandVariables();
    const startedAt = Date.now();
    let buffer = "";
    let rendered = false;
    let stderrTail = "";
    const child = spawn(resolveVariables(this.item.command, variables), {
      shell: true,
      cwd: resolveVariables(this.item.cwd, variables),
      // Its own process group, so stopping it also stops what the shell started.
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      const { lines, rest } = takeLines(buffer, chunk);
      buffer = rest;
      for (const line of lines) {
        this.render(interpretRun({ id: this.item.id, exitCode: 0, stdout: line }));
        rendered = true;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      stderrTail = (stderrTail + chunk).slice(-2000);
      this.output.appendLine(`[${this.item.id}] ${String(chunk).trimEnd()}`);
    });
    child.on("error", error => {
      stderrTail = error.message;
    });
    child.on("close", code => {
      if (this.child === child) this.child = null;
      // A child stopped on purpose (refresh, dispose) is not restarted here.
      if (this.disposed || child.stoppedByProbe) return;
      // Keep the last status the command printed; show an error only when
      // it printed none.
      if (!rendered) {
        this.render(interpretRun({ id: this.item.id, exitCode: code ?? 1, stdout: buffer, stderr: stderrTail }));
      }
      this.restartDelay = nextRestartDelay(this.restartDelay, Date.now() - startedAt);
      this.restartTimer = setTimeout(() => this.startWatch(), this.restartDelay);
    });
  }

  stopWatch() {
    clearTimeout(this.restartTimer);
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    child.stoppedByProbe = true;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill();
    } catch {
      child.kill();
    }
  }

  refresh() {
    if (this.item.watch) {
      this.stopWatch();
      this.restartDelay = 0;
      this.startWatch();
      return;
    }
    if (this.running) {
      // The run in flight may predate what triggered this refresh.
      this.rerun = true;
      return;
    }
    const variables = commandVariables();
    this.running = true;
    this.rerun = false;
    exec(
      resolveVariables(this.item.command, variables),
      {
        cwd: resolveVariables(this.item.cwd, variables),
        timeout: this.item.timeoutSeconds * 1000,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        this.running = false;
        if (this.disposed) return;
        if (stderr && stderr.trim()) this.output.appendLine(`[${this.item.id}] ${stderr.trim()}`);
        const shown = interpretRun({
          id: this.item.id,
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout,
          stderr,
          errorMessage: error?.killed ? `timed out after ${this.item.timeoutSeconds}s` : null
        });
        this.render(shown);
        if (this.rerun) this.refresh();
      }
    );
  }

  links(execution) {
    return taskMatches(this.item.refreshOnTasks, execution?.task?.name);
  }

  taskStarted(execution) {
    if (!this.links(execution)) return;
    this.tasks.add(execution);
    this.applyText();
  }

  taskEnded(execution) {
    if (!this.tasks.delete(execution)) return;
    this.applyText();
    this.refresh();
  }

  applyText() {
    if (this.shownText == null) return;
    const busy = this.tasks.size > 0 && this.item.showTaskProgress;
    this.bar.text = busy ? `$(sync~spin) ${this.shownText}` : this.shownText;
  }

  render(shown) {
    this.open = shown.open;
    this.shownText = shown.text;
    this.applyText();
    if (shown.markdown) {
      const tooltip = new vscode.MarkdownString(shown.tooltip);
      tooltip.supportThemeIcons = true;
      // Command output is untrusted: no command links, no raw HTML.
      tooltip.isTrusted = false;
      tooltip.supportHtml = false;
      this.bar.tooltip = tooltip;
    } else {
      this.bar.tooltip = shown.tooltip;
    }
    const background = BACKGROUND[shown.level];
    this.bar.backgroundColor = background ? new vscode.ThemeColor(background) : undefined;
  }

  click() {
    if (this.open) {
      vscode.env.openExternal(vscode.Uri.parse(this.open));
    } else {
      this.bar.text = `$(sync~spin) ${this.item.id}`;
      this.refresh();
    }
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.stopWatch();
    this.bar.dispose();
  }
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const output = vscode.window.createOutputChannel("Status Probe");
  /** @type {Map<string, Probe>} */
  const probes = new Map();

  const disposeAll = () => {
    for (const probe of probes.values()) probe.dispose();
    probes.clear();
  };

  const build = () => {
    disposeAll();
    // package.json declares untrustedWorkspaces unsupported, so VS Code does
    // not activate this in a Restricted Mode window; this is a second guard.
    if (!vscode.workspace.isTrusted) return;
    const raw = vscode.workspace.getConfiguration("statusProbe").get("items", []);
    (Array.isArray(raw) ? raw : []).forEach((entry, index) => {
      const { item, problem } = normalizeItem(entry, index);
      if (problem) {
        output.appendLine(problem);
        return;
      }
      if (probes.has(item.id)) {
        output.appendLine(`statusProbe item "${item.id}" is defined twice; using the first`);
        return;
      }
      const probe = new Probe(item, output);
      // A linked task may already be running when settings change.
      for (const execution of vscode.tasks.taskExecutions || []) probe.taskStarted(execution);
      probes.set(item.id, probe);
    });
  };

  context.subscriptions.push(
    output,
    { dispose: disposeAll },
    vscode.commands.registerCommand("statusProbe.click", id => probes.get(id)?.click()),
    vscode.commands.registerCommand("statusProbe.refresh", () => {
      for (const probe of probes.values()) probe.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("statusProbe")) build();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(build),
    vscode.tasks.onDidStartTask(event => {
      for (const probe of probes.values()) probe.taskStarted(event.execution);
    }),
    vscode.tasks.onDidEndTask(event => {
      for (const probe of probes.values()) probe.taskEnded(event.execution);
    })
  );
  build();
}

function deactivate() {}

module.exports = { activate, deactivate };
