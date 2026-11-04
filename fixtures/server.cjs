"use strict";
// Local-only demo. The receiver discards data and never logs request URLs or bodies.
const http = require("node:http");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.url === "/" || req.url === "/fixture.js" || req.url === "/fixture.css") {
    const file = req.url === "/" ? "index.html" : req.url.slice(1);
    res.setHeader("Content-Type", file.endsWith("html") ? "text/html; charset=utf-8" : file.endsWith("css") ? "text/css" : "application/javascript");
    res.end(readFileSync(join(__dirname, file)));
  } else if (req.url.startsWith("/redirect")) {
    res.writeHead(302, {Location: "http://127.0.0.1:4174/collect"});
    res.end();
  } else {
    req.resume();
    res.writeHead(req.method === "OPTIONS" ? 204 : 200, {"Content-Type": "text/plain"});
    res.end("local fixture: discarded");
  }
}
const servers = [4173, 4174].map(port => http.createServer(handler).listen(port, "127.0.0.1"));
for (const server of servers) server.on("error", error => { console.error(error.message); process.exitCode = 1; });
console.log("Local demo: http://127.0.0.1:4173 — use dummy data only.");
process.on("SIGTERM", () => servers.forEach(server => server.close()));
