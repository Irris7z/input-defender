"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../extension/core.js");
const base = {source: "https://shop.example", destination: "https://collect.example", categories: ["card"], kind: "fetch", recentInput: true, attempt: true};
test("schema attributes classify Japanese and standard payment fields", () => {
  assert.equal(Core.fieldCategory({autocomplete: "section-checkout cc-number"}), "card");
  assert.equal(Core.fieldCategory({name: "住所"}), "address");
  assert.equal(Core.fieldCategory({autocomplete: "family-name"}), "name");
  assert.equal(Core.fieldCategory({type: "email"}), "email");
  assert.equal(Core.fieldCategory({type: "hidden", name: "card-number"}), null);
  assert.equal(Core.fieldCategory({name: "search"}), null);
});
test("origin normalization strips paths, query, credentials, fragments", () => {
  assert.equal(Core.origin("https://user:pass@collect.example/private/secret?card=123#name"), "https://collect.example");
  assert.equal(Core.origin("/collect?secret=abc", "https://shop.example"), "https://shop.example");
  assert.equal(Core.origin("wss://shop.example/socket?token=secret"), "https://shop.example");
  for (const url of ["data:text/plain,secret", "javascript:alert(1)", "file:///secret", "not a url"]) assert.equal(Core.origin(url), null);
});
test("cross-origin API calls near input are heuristic warnings; default never blocks", () => {
  assert.equal(Core.analyze(base).reason, "typing-transfer");
  assert.equal(Core.analyze(base).blocked, false);
  assert.equal(Core.analyze(base, {mode: "block"}).blocked, true);
});
test("same-origin HTTPS and calls outside the input window are not flagged", () => {
  assert.equal(Core.analyze({...base, destination: base.source}), null);
  assert.equal(Core.analyze({...base, recentInput: false}), null);
  assert.equal(Core.analyze({...base, categories: []}), null);
  assert.equal(Core.analyze({...base, userSubmitted: true}), null);
});
test("WebSocket does not look external when only the transport differs", () => {
  assert.equal(Core.analyze({...base, kind: "websocket", destination: "wss://shop.example/socket"}), null);
});
test("form destination changes and insecure forms warn without needing an input value", () => {
  assert.equal(Core.analyze({...base, kind: "form", changed: true, recentInput: false}).reason, "form-changed");
  assert.equal(Core.analyze({...base, kind: "form", recentInput: false}).severity, "medium");
  assert.equal(Core.analyze({...base, kind: "form", destination: "http://shop.example", recentInput: false}).reason, "insecure");
});
test("structural observations and browser-side network observations cannot claim blocking", () => {
  assert.equal(Core.analyze({...base, kind: "network"}, {mode: "block"}).blocked, false);
  assert.equal(Core.analyze({...base, kind: "form", changed: true, attempt: false}, {mode: "block"}).blocked, false);
});
test("allowlist is an exact source/destination pair, without wildcard or subdomain inheritance", () => {
  const settings = {mode: "block", allowlist: [{source: base.source, destination: base.destination}]};
  assert.equal(Core.analyze(base, settings), null);
  assert.ok(Core.analyze({...base, source: "https://other.example"}, settings));
  assert.ok(Core.analyze({...base, destination: "https://sub.collect.example"}, settings));
});
test("page messages are reduced to an enum-only metadata schema", () => {
  const event = Core.sanitizeIncident({...Core.analyze(base), source: "https://forged.example", value: "secret", body: "secret", url: "secret", categories: ["card", "secret"], destination: "https://collect.example/path?secret=abc"}, base.source);
  assert.equal(event.source, base.source);
  assert.equal(event.destination, base.destination);
  assert.deepEqual(event.categories, ["card"]);
  assert.equal(JSON.stringify(event).includes("secret"), false);
  assert.equal(Core.sanitizeIncident({...event, reason: "arbitrary secret"}, base.source), null);
});
test("invalid settings cannot enable arbitrary modes or preserve extra payload fields", () => {
  assert.deepEqual(Core.sanitizeSettings(null), {mode: "observe", allowlist: []});
  assert.deepEqual(Core.sanitizeSettings({mode: "disabled", allowlist: [{source: "javascript:secret", destination: base.destination}, {source: base.source, destination: `${base.destination}/?secret=abc`, value: "secret"}]}), {mode: "observe", allowlist: [{source: base.source, destination: base.destination}]});
});
