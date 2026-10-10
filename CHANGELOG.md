# Changelog

## 0.4.0

- `intervalSeconds: 0` turns an item's timer off. It runs at startup, when
  clicked, and when a linked task ends, for statuses only your own tasks
  change.
- README: a "Choosing a mode" section on which combinations fit which
  sources.
- Windows: stopping a watch command now stops everything it started
  (`taskkill /T /F`). Before, only the shell was killed, which left the
  real program, such as a `node` listener, running after every refresh or
  window reload.
- A watch command that exits within 5 s three times in a row gets a hint in
  the output channel: it looks like an ordinary command meant for interval
  mode.

## 0.3.0

- `refreshOnTasks` links an item to VS Code tasks by label (a trailing `*`
  matches a prefix). While a linked task runs, the item shows a spinner
  (`showTaskProgress: false` turns that off); when it ends, the item
  refreshes.

## 0.2.0

- `watch: true` runs an item's command as an event listener: started once,
  it prints a line per event, and each line updates the item. A command
  that exits is restarted with backoff (2 s doubling to 60 s), and the item
  keeps its last status meanwhile.

## 0.1.0

- First release: `statusProbe.items` runs commands on an interval and renders
  their JSON (`text`, `tooltip`, `level`, `open`) or plain-text output.
