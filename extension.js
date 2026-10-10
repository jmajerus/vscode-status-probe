"use strict";

const vscode = require("vscode");
const { exec } = require("node:child_process");
const os = require("node:os");

const { normalizeItem, resolveVariables, interpretRun } = require("./lib/probe");

const BACKGROUND = {
  warn: "statusBarItem.warningBackground",
  error: "statusBarItem.errorBackground"
};

/** One status bar item driven by one configured command. */
class Probe {
  constructor(item, output) {
    this.item = item;
    this.output = output;
    this.running = false;
    this.open = null;
    this.bar = vscode.window.createStatusBarItem(
      `statusProbe.${item.id}`,
      item.alignment === "right" ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left,
      item.priority
    );
    this.bar.name = `Status Probe: ${item.id}`;
    this.bar.text = `$(sync~spin) ${item.id}`;
    this.bar.command = { command: "statusProbe.click", title: "Status Probe", arguments: [item.id] };
    this.bar.show();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), item.intervalSeconds * 1000);
  }

  refresh() {
    if (this.running) return;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    const variables = { workspaceFolder: folder, userHome: os.homedir() };
    this.running = true;
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
      }
    );
  }

  render(shown) {
    this.open = shown.open;
    this.bar.text = shown.text;
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
      probes.set(item.id, new Probe(item, output));
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
    vscode.workspace.onDidChangeWorkspaceFolders(build)
  );
  build();
}

function deactivate() {}

module.exports = { activate, deactivate };
