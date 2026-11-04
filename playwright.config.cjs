"use strict";
module.exports = {
  testDir: "./tests/browser",
  timeout: 30000,
  workers: 1,
  reporter: "list",
  webServer: {command: "node fixtures/server.cjs", url: "http://127.0.0.1:4173", reuseExistingServer: false},
  use: {trace: "retain-on-failure"}
};
