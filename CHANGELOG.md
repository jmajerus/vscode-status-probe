# Changelog

## 0.2.0

- `watch: true` runs an item's command as an event listener: started once,
  it prints a line per event, and each line updates the item. A command
  that exits is restarted with backoff (2 s doubling to 60 s), and the item
  keeps its last status meanwhile.

## 0.1.0

- First release: `statusProbe.items` runs commands on an interval and renders
  their JSON (`text`, `tooltip`, `level`, `open`) or plain-text output.
