"use strict";

// Test fixture (outside test/, so `node --test` doesn't run it): a listener
// that starts a grandchild, prints the grandchild's pid, and stays up.
// test/process-tree.test.js checks that stopping the tree reaches it.
const { spawn } = require("node:child_process");

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(JSON.stringify({ text: "up", grandchild: grandchild.pid }));
setInterval(() => {}, 1000);
