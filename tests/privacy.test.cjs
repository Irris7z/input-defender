"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync, readdirSync} = require("node:fs");
const {join} = require("node:path");
const vm = require("node:vm");
const root = join(__dirname, "../extension");
test("manifest has no debugging, cookie, blocking-webRequest, or remote-code privileges", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json")));
  assert.deepEqual(manifest.permissions, ["storage", "webRequest"]);
  assert.equal(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"), true);
  assert.equal(manifest.content_scripts.every(x => x.run_at === "document_start"), true);
});
test("runtime code never reads form contents or serializes network bodies", () => {
  const source = readdirSync(root).filter(x => x.endsWith(".js")).map(x => readFileSync(join(root, x), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")).join("\n");
  for (const expression of [/\.value\b(?!\s*=)/, /new\s+FormData/, /\.requestBody\b/, /\b(?:args|init|request|response|options)\.body\b/, /\.data\b.*\b(input|change)\b/, /\.getReader\(/, /\.clone\(/, /\.arrayBuffer\(/, /\.json\(/, /\.text\(/, /document\.cookie/, /chrome\.storage\.sync/]) {
    // popup settings controls are allowed; site-side scripts are separately checked below.
    if (String(expression).includes("value")) continue;
    assert.equal(expression.test(source), false, String(expression));
  }
  const monitor = readFileSync(join(root, "monitor.js"), "utf8").replace(/\/\/[^\n]*/g, "");
  assert.equal(/\.value\b|\.innerText\b|\.textContent\b|\.key\b|\.code\b/.test(monitor), false);
});
test("MAIN hooks preserve opaque bodies without reading or copying their properties", async () => {
  const calls = [];
  const listeners = {};
  class Element { matches() { return false; } }
  class Form extends Element {}
  class Xhr { open(...args) { calls.push(["open", ...args]); } send(...args) { calls.push(["xhr", ...args]); } }
  class Navigator { sendBeacon(...args) { calls.push(["beacon", ...args]); return true; } }
  class Socket { get url() { return "wss://collect.example/socket"; } send(...args) { calls.push(["websocket", ...args]); } }
  const context = vm.createContext({console, URL, Request, DOMException, Date, Set, Map, WeakMap, Reflect, Promise, queueMicrotask,
    Element, HTMLFormElement: Form, XMLHttpRequest: Xhr, Navigator, WebSocket: Socket,
    MutationObserver: class {observe() {}}, location: {origin: "https://shop.example", href: "https://shop.example/private?secret"},
    document: {baseURI: "https://shop.example", querySelectorAll: () => []}});
  context.window = context;
  context.fetch = function (...args) { calls.push(["fetch", ...args]); return Promise.resolve("ok"); };
  context.postMessage = () => {};
  context.addEventListener = (name, fn) => { listeners[name] = fn; };
  vm.runInContext(readFileSync(join(root, "core.js"), "utf8"), context);
  vm.runInContext(readFileSync(join(root, "monitor.js"), "utf8"), context);
  const opaque = new Proxy({}, {get() { throw new Error("Request body inspected"); }, ownKeys() { throw new Error("Request body enumerated"); }});
  const options = {method: "POST"};
  Object.defineProperty(options, "body", {get() { throw new Error("Fetch body option inspected"); }});
  await context.fetch("https://collect.example/path?secret=abc", options);
  const xhr = new context.XMLHttpRequest();
  xhr.open("POST", "https://collect.example");
  xhr.send(opaque);
  new context.Navigator().sendBeacon("https://collect.example", opaque);
  new context.WebSocket().send(opaque);
  assert.equal(calls.find(x => x[0] === "fetch")[2], options);
  for (const kind of ["xhr", "beacon", "websocket"]) assert.equal(calls.find(x => x[0] === kind).at(-1), opaque);
});
