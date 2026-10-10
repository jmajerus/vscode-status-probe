# Status Probe

Status bar items driven by your own commands. An item either re-runs its
command on an interval, or (`watch`) runs it as an event listener that
reports each change as it happens. The command prints JSON lines, and Status Probe renders each
one: text, a markdown tooltip, a warning or error background, and a link to
open on click.

The extension knows nothing about what you're checking. A deploy, a server, a
queue, a quota: all of that logic lives in your script, in your project.

```jsonc
// .vscode/settings.json
{
  "statusProbe.items": [
    {
      "id": "staging",
      "command": "node tools/staging-status.mjs",
      "intervalSeconds": 300
    }
  ]
}
```

## Interval or watch

By default an item runs its command every `intervalSeconds` and reads the
**last non-empty line of stdout** when it exits.

With `"watch": true`, the command is an **event listener**. Status Probe
starts it once. The command listens for events from whatever it watches (a
Server-Sent Events stream, a websocket, a file watcher, `tail -f`) and prints
one line per event. Status Probe listens on the command's stdout, and each
line becomes the item's new status.

`watch` describes the command, so it's off by default: an ordinary command
that exits after printing would only be restarted over and over. If a watch
command exits within 5 seconds three times in a row, Status Probe writes a
hint to its output channel saying so.

If the command exits, the item keeps its last status, and the command is
started again after 2 s, then 4 s, doubling up to 60 s. The delay starts over
after a run that lasted a minute. Exiting is also a reasonable way to reload
configuration, such as an edited `.env`.

```jsonc
{
  "statusProbe.items": [
    { "id": "deploys", "command": "node tools/deploy-status.mjs --watch", "watch": true }
  ]
}
```

## Linking tasks

An item can follow VS Code tasks that change what it reports, such as a
deploy:

```jsonc
{
  "id": "staging",
  "command": "node tools/staging-status.mjs",
  "refreshOnTasks": ["Deploy staging", "Migrate staging*"]
}
```

While a linked task runs, the item shows a spinner in front of its text.
When the task ends, whatever its exit code, the item refreshes: an interval
item re-runs its command right away, and a watch item restarts its listener.
Status Probe listens for the tasks themselves, so it doesn't matter how they
start: a task button from another extension, **Tasks: Run Task**, a
keybinding, or another task's `dependsOn`.

Patterns are exact task labels, or a prefix ending in `*`. A watch item whose
listener already hears the change gets nothing from the refresh, but the
spinner still shows that an update is on its way. Set
`"showTaskProgress": false` to turn the spinner off.

## Choosing a mode

An item updates for one or more reasons: a timer, events from its own
source (`watch`), or VS Code tasks ending (`refreshOnTasks`). Pick them by
asking what can tell you about a change.

| Setup | Updates on | Fits when |
|---|---|---|
| Interval | The timer | Nothing reports changes, so you have to ask. A quota or balance API. |
| Interval + `refreshOnTasks` | The timer, and each linked task ending | Your own tasks cause most changes, but not all. The task updates the item right after your deploy; a long interval catches changes made elsewhere, by a teammate or a CI job. |
| `watch` | The source's events | Something reports changes: a Server-Sent Events stream, a websocket, a file watcher. The best fit when one is available. |
| `watch` + `refreshOnTasks` | Events, and a listener restart when a linked task ends | A slow task you'd like to see in progress: the spinner shows an update is coming. The restart is a fallback for a source that can miss a change. |
| `refreshOnTasks` with `"intervalSeconds": 0` | Linked tasks ending, plus startup and clicks | Only your own tasks change the status. The result of the last local build or migration. |

Rule of thumb: if your source can report changes, write the command as a
listener (one that stays running and prints a line per event) and set
`watch: true`. That's the best fit when it's possible. Otherwise the default,
interval mode, re-runs an ordinary command that prints and exits. Add
`refreshOnTasks` when your own tasks cause changes, and keep a timer only as
a backstop for changes nothing reports. `watch` turns the timer off by
itself, since a command that never exits has nothing to re-run.

## The output contract

Each line Status Probe reads is used like this when it's a JSON object with a
`text` field:

| Field | Meaning |
|---|---|
| `text` | Status bar text. [Codicons](https://code.visualstudio.com/api/references/icons-in-labels) such as `$(server)` work. Clipped to 80 characters. |
| `tooltip` | Hover text, as Markdown. Shown with no command links and no raw HTML. |
| `level` | `ok` (default), `warn` (warning background) or `error` (error background). |
| `open` | An `http(s)` URL to open when the item is clicked. Without one, a click re-runs the command. |

```json
{"text":"$(server) main ↓3","tooltip":"**Staging** is 3 commits behind main","level":"warn","open":"https://staging.example/admin"}
```

Any other line is shown as plain text, with no background. In interval
mode that's the first stdout line, and only when the command exits 0. A
non-zero exit, a timeout or a missing command shows `$(error) <id>` on the
error background, with stderr in the tooltip. stderr also goes to the **Status Probe** output channel.

Exit 0 and report problems through `level`. That way the item shows what
went wrong instead of a generic error.

## Item settings

| Setting | Default | |
|---|---|---|
| `id` | required | Unique name for the item. |
| `command` | required | Shell command. `${workspaceFolder}` and `${userHome}` are substituted. |
| `watch` | `false` | Run the command as an event listener: started once, it prints a line per event, and each line becomes the item's status. |
| `cwd` | `${workspaceFolder}` | Working directory. In a multi-root window, `${workspaceFolder}` is the first folder. |
| `intervalSeconds` | `300` | Seconds between runs, minimum 10. `0` turns the timer off: the item runs at startup, on click, and after linked tasks. Not used with `watch`. |
| `timeoutSeconds` | `60` | Seconds before the run is stopped and shown as an error. Not used with `watch`. |
| `alignment` | `left` | `left` or `right`. |
| `priority` | `0` | Higher sits farther toward the outer edge of its side. |
| `refreshOnTasks` | `[]` | Task labels (or `prefix*`) that show a spinner while they run and refresh the item when they end. |
| `showTaskProgress` | `true` | Show that spinner. |

**Status Probe: Refresh All** re-runs every item now, and restarts `watch`
commands. Clicking an item without an `open` link does the same for that
item.

## Trust

Status Probe runs shell commands from your settings, including a workspace's
`.vscode/settings.json`. It only runs in
[trusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust)
and stays inactive in Restricted Mode. Command output is treated as untrusted:
tooltips can't run commands, and `open` accepts only `http` and `https`
links.

## Install from source

```sh
npm run package                       # writes dist/status-probe-<version>.vsix
code --install-extension dist/status-probe-*.vsix
```

## Develop

Plain JavaScript, no build step. `lib/` holds the logic that doesn't need
VS Code, with its own tests (`npm test`), including one that starts a real
process tree and checks that stopping a watch command stops all of it. CI runs
the tests on Linux, macOS and Windows. To try changes, open this
folder in VS Code and press F5 to launch an Extension Development Host.
