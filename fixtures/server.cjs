"use strict";
// Local-only demo. The receiver discards data and never logs request URLs or bodies.
const http = require("node:http");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/attack-lab.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(readFileSync(join(__dirname, "attack-lab.html")));
  } else if (req.url.startsWith("/lab/collect?kind=")) {
    // Only classify fixed method names. Never parse or keep payload/query values.
    const image = req.url.startsWith("/lab/collect?kind=image&");
    const form = req.url === "/lab/collect?kind=form";
    req.resume();
    req.once("end", () => {
      if (image) {
        res.setHeader("Content-Type", "image/png");
        res.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hJcAAAAASUVORK5CYII=", "base64"));
      } else if (form) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors http://127.0.0.1:4173");
        res.end('<!doctype html><meta charset="utf-8"><title>受信・破棄済み</title><script>parent.postMessage({source:"input-defender-local-receiver",kind:"form"},"http://127.0.0.1:4173");</script>');
      } else {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Local test received; body discarded.");
      }
    });
  } else if (req.url === "/" || req.url === "/fixture.js" || req.url === "/fixture.css") {
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
console.log("Attack lab: http://127.0.0.1:4173/attack-lab.html — loopback destinations only.");
process.on("SIGTERM", () => servers.forEach(server => server.close()));
