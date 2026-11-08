"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const vm = require("node:vm");
const manifest = require("../ios/Safari/manifest.json");

test("Safari profile keeps separate execution worlds without network or native-messaging permissions", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.browser_specific_settings.safari.strict_min_version, "26.0");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts.map(c => c.world), ["MAIN", "ISOLATED"]);
  assert.equal(manifest.content_scripts.every(c => c.run_at === "document_start"), true);
  assert.equal(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"), true);
  const handler = readFileSync("ios/Input Defender/Input Defender Extension/SafariWebExtensionHandler.swift", "utf8");
  assert.equal(/context\.inputItems|os_log|print\(|userInfo\?\[|sendNativeMessage/.test(handler), false);
  const macHandler = readFileSync("macos/Input Defender/Input Defender Extension/SafariWebExtensionHandler.swift", "utf8");
  assert.equal(macHandler, handler, "Both native handlers must refuse payloads without inspecting them");
});

test("Safari background works without Chrome-only access/badge/network APIs, retaining only sanitized session metadata", async () => {
  const local = {}, session = {}, sent = [], handlers = {};
  const area = target => ({get: async key => key === null ? {...target} : {[key]: target[key]}, set: async values => Object.assign(target, values), remove: async key => { delete target[key]; }});
  const event = name => ({addListener: fn => { handlers[name] = fn; }});
  const chrome = {runtime: {id: "test-extension", getURL: path => `safari-web-extension://uuid/${path}`, getManifest: () => manifest, onMessage: event("message")},
    storage: {local: area(local), session: area(session)}, action: {},
    tabs: {query: async () => [{id: 1}], sendMessage: async (...args) => sent.push(args), onRemoved: event("removed"), onUpdated: event("updated")}};
  Object.defineProperty(chrome, "webRequest", {get() { throw new Error("Unsupported Safari network API accessed"); }});
  const context = vm.createContext({chrome, URL, console, Date, Set, Map, Promise});
  context.importScripts = path => vm.runInContext(readFileSync(`extension/${path}`, "utf8"), context);
  vm.runInContext(readFileSync("extension/background.js", "utf8"), context);
  const sender = {id: chrome.runtime.id, tab: {id: 1}, frameId: 0, url: "https://shop.example/path?PRIVATE=1"};
  const send = (message, from = sender) => new Promise(resolve => handlers.message(message, from, resolve));
  assert.ok((await send({type: "config"})).settings);
  await send({type: "structure", structure: {complete: true, sensitiveFieldCount: 1, categories: ["card", "PRIVATE"],
    forms: [{destination: "https://collector.example/path?PRIVATE=1", method: "GET", categories: ["card"], count: 1}], value: "PRIVATE"}});
  await send({type: "incident", incident: {reason: "typing-transfer", kind: "fetch", destination: "https://collector.example/path?PRIVATE=1", categories: ["card"], value: "PRIVATE", body: "PRIVATE"}});
  assert.equal(session["tab:1"].events[0].destination, "https://collector.example");
  assert.equal(session["tab:1"].frames["0"].structure.forms[0].method, "GET");
  assert.equal(JSON.stringify({local, session, sent}).includes("PRIVATE"), false);
  assert.deepEqual(local, {}, "Detection metadata must not fall back to persistent storage");
  const popup = {id: chrome.runtime.id, url: chrome.runtime.getURL("popup.html")};
  assert.ok((await send({type: "snapshot", tabId: 1}, popup)).state);
  assert.equal((await send({type: "snapshot", tabId: 1})).error, "Unknown request");
  await send({type: "clear", tabId: 1}, popup);
  assert.equal(session["tab:1"].events.length, 0);
});
