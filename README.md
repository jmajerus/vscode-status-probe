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
| `intervalSeconds` | `300` | Seconds between runs, minimum 10. Not used with `watch`. |
| `timeoutSeconds` | `60` | Seconds before the run is stopped and shown as an error. Not used with `watch`. |
| `alignment` | `left` | `left` or `right`. |
| `priority` | `0` | Higher sits farther toward the outer edge of its side. |

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

Plain JavaScript, no build step. `lib/probe.js` holds the logic that doesn't
need VS Code and has its own tests (`npm test`). To try changes, open this
folder in VS Code and press F5 to launch an Extension Development Host.
