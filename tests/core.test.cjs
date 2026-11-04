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
  assert.equal(Core.analyze({...base, kind: "form", recentInput: false}).severity, "WARNING");
  assert.deepEqual(Core.analyze({...base, kind: "form", destination: "http://shop.example", recentInput: false}).reasons, ["form-external", "insecure"]);
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
test("HTTP never masks early cross-origin transfers, and blocking uses the combined risk", () => {
  const event = Core.analyze({...base, destination: "http://collect.example"}, {mode: "block"});
  assert.equal(event.reason, "typing-transfer");
  assert.deepEqual(event.reasons, ["typing-transfer", "insecure"]);
  assert.equal(event.blocked, true);
  assert.deepEqual(Core.analyze({...base, destination: "http://collect.example", userSubmitted: true}).reasons, ["insecure"]);
});
test("HTTP forms retain destination changes and cross-origin destinations together", () => {
  const event = Core.analyze({...base, kind: "form", destination: "http://collect.example", changed: true, recentInput: false});
  assert.equal(event.reason, "form-changed");
  assert.deepEqual(event.reasons, ["form-changed", "form-external", "insecure"]);
  assert.equal(event.blocked, false);
});
test("browser observations retain both HTTP and redirect evidence without claiming blocking", () => {
  const event = Core.analyze({...base, kind: "network", destination: "http://collect.example", redirect: true}, {mode: "block"});
  assert.deepEqual(event.reasons, ["external-redirect", "insecure"]);
  assert.equal(event.severity, "CRITICAL");
  assert.equal(event.blocked, false);
});
test("multiple reasons accept only known codes, de-duplicate, and support legacy records", () => {
  const event = Core.sanitizeIncident({...Core.analyze(base), reasons: ["insecure", "PRIVATE-VALUE", "typing-transfer", "insecure"]}, base.source);
  assert.deepEqual(event.reasons, ["typing-transfer", "insecure"]);
  assert.equal(JSON.stringify(event).includes("PRIVATE-VALUE"), false);
  assert.deepEqual(Core.incidentReasons({reason: "insecure"}), ["insecure"]);
});
test("severity taxonomy is WARNING / CRITICAL / FATAL with stable priority and legacy support", () => {
  assert.equal(Core.reasonSeverity("insecure"), "WARNING");
  assert.equal(Core.reasonSeverity("form-external"), "WARNING");
  assert.equal(Core.reasonSeverity("typing-transfer"), "CRITICAL");
  assert.equal(Core.reasonSeverity("network-after-input"), "CRITICAL");
  assert.equal(Core.reasonSeverity("external-redirect"), "CRITICAL");
  assert.equal(Core.reasonSeverity("form-changed"), "FATAL");
  assert.deepEqual(["WARNING", "FATAL", "CRITICAL"].sort((a, b) => Core.SEVERITY_RANK[a] - Core.SEVERITY_RANK[b]), ["FATAL", "CRITICAL", "WARNING"]);
  assert.equal(Core.incidentSeverity({reason: "form-changed", severity: "high"}), "FATAL");
  const tampered = Core.analyze({...base, kind: "form", destination: "http://collect.example", changed: true});
  assert.equal(tampered.severity, "FATAL");
  const plain = Core.analyze({...base, destination: "http://shop.example", userSubmitted: true}, {mode: "block"});
  assert.equal(plain.severity, "WARNING");
  assert.equal(plain.blocked, true, "severity labels must not silently relax the existing HTTP blocking policy");
});
