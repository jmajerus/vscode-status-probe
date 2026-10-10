# Changelog

## 0.2.0

- `watch: true` starts an item's command once and updates the item whenever
  the command prints a line, so a command can push changes instead of being
  re-run. A command
  that exits is restarted with backoff (2 s doubling to 60 s), and the item
  keeps its last status meanwhile.

## 0.1.0

- First release: `statusProbe.items` runs commands on an interval and renders
  their JSON (`text`, `tooltip`, `level`, `open`) or plain-text output.
