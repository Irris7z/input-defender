"use strict";
const {test, expect, chromium} = require("@playwright/test");
const {mkdtempSync, rmSync, mkdirSync} = require("node:fs");
const {tmpdir} = require("node:os");
const {join, resolve} = require("node:path");
let context, worker, profile, extensionId, page;
let errors = [];
const site = "http://127.0.0.1:4173";
const destination = "http://127.0.0.1:4174";
async function tabId() {
  return worker.evaluate(async site => (await chrome.tabs.query({})).find(t => t.url?.startsWith(site))?.id, site);
}
async function state() {
  const id = await tabId();
  return worker.evaluate(async id => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], id);
}
async function config(value) {
  await worker.evaluate(async settings => {
    await chrome.storage.local.set({settings});
    for (const tab of await chrome.tabs.query({})) await chrome.tabs.sendMessage(tab.id, {type: "config-changed", settings}).catch(() => {});
  }, value);
}
async function input() {
  await page.locator('[name="full-name"]').fill("DUMMY-NAME-SECRET");
  await expect.poll(async () => Object.values((await state())?.frames || {}).some(f => f.lastInput > 0)).toBe(true);
}
async function hasEvent(predicate) {
  await expect.poll(async () => (await state())?.events.some(predicate)).toBe(true);
}
test.beforeAll(async () => {
  profile = mkdtempSync(join(tmpdir(), "input-defender-test-"));
  const extension = resolve(__dirname, "../../extension");
  context = await chromium.launchPersistentContext(profile, {channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extensionId = worker.url().split("/")[2];
});
test.beforeEach(async () => {
  errors = [];
  await config({mode: "observe", allowlist: []});
  page = await context.newPage();
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
  await page.goto(site);
  await expect.poll(async () => (await state())?.monitoring).toBe(true);
});
test.afterEach(async () => {
  await page.close();
  expect(errors).toEqual([]);
});
test.afterAll(async () => { await context?.close(); if (profile) rmSync(profile, {recursive: true, force: true}); });

test("loaded extension identifies a sensitive HTTP form without inspecting values", async () => {
  await hasEvent(e => e.reason === "insecure" && e.kind === "form");
  expect((await state()).events.every(e => e.blocked === false)).toBe(true);
});
test("structure scanning finds GET risks and sensitive fields before any input, without retaining URL paths", async () => {
  await page.goto(`${site}/structure-lab.html`);
  await hasEvent(e => e.kind === "form" && e.reasons.includes("form-query") && !e.blocked);
  await expect.poll(async () => (await state())?.frames["0"]?.structure?.complete).toBe(true);
  const snapshot = (await state()).frames["0"];
  expect(snapshot.lastInput).toBe(0);
  expect(snapshot.structure.sensitiveFieldCount).toBe(1);
  expect(snapshot.structure.forms).toContainEqual({destination: site, method: "GET", categories: ["name"], count: 1});
  expect(JSON.stringify(snapshot.structure)).not.toContain("structure-probe");
  await expect(page.locator('[name="full-name"]')).toHaveValue("");
});
test("new external script and frame origins warn before input even when page APIs are overwritten", async () => {
  await page.goto(`${site}/structure-lab.html`);
  await expect.poll(async () => (await state())?.frames["0"]?.structure?.complete).toBe(true);
  await page.evaluate(() => { document.querySelectorAll = () => []; });
  await page.click("#add-script");
  await hasEvent(e => e.reason === "script-origin-added" && e.severity === "CRITICAL" && !e.blocked);
  await page.click("#add-frame");
  await hasEvent(e => e.reason === "frame-origin-added" && e.severity === "WARNING" && !e.blocked);
  expect((await state()).frames["0"].lastInput).toBe(0);
  await expect.poll(async () => (await state())?.frames["0"]?.structure?.scripts.some(s => s.origin === destination)).toBe(true);
});
test("initial third-party scripts are inventoried without declaring their existence malicious", async () => {
  const html = require("node:fs").readFileSync(resolve("fixtures/structure-lab.html"), "utf8").replace(`${site}/structure-probe.js`, `${destination}/structure-probe.js`);
  await page.route("**/structure-lab.html", route => route.fulfill({contentType: "text/html", body: html}));
  await page.goto(`${site}/structure-lab.html`);
  await expect.poll(async () => (await state())?.frames["0"]?.structure?.externalScriptCount).toBe(1);
  expect((await state()).events.some(e => e.reason === "script-origin-added")).toBe(false);
  expect((await state()).frames["0"].structure.scripts).toEqual([{origin: destination, count: 1, integrityCount: 0}]);
});
test("formmethod overrides and controls associated from outside a form are scanned and blocked on submit", async () => {
  await page.goto(`${site}/structure-lab.html`);
  await page.evaluate(() => {
    document.getElementById("query-form").remove();
    const form = document.createElement("form");
    form.id = "associated"; form.method = "POST"; form.action = "/collect"; form.target = "receiver";
    const field = document.createElement("input"); field.name = "email"; field.setAttribute("form", "associated");
    const button = document.createElement("button"); button.id = "override-submit"; button.setAttribute("form", "associated"); button.setAttribute("formmethod", "GET"); button.textContent = "Empty GET override";
    document.body.append(form, field, button);
  });
  await expect.poll(async () => (await state())?.frames["0"]?.structure?.forms.map(f => f.method).sort()).toEqual(["GET", "POST"]);
  await config({mode: "block", allowlist: []});
  const request = page.waitForRequest(r => r.url().startsWith(`${site}/collect`), {timeout: 800}).catch(() => null);
  await page.click("#override-submit");
  expect(await request).toBeNull();
  await hasEvent(e => e.blocked && e.reasons.includes("form-query"));
});
test("structure panel fits a narrow popup and displays metadata rather than a safety score", async () => {
  await page.goto(`${site}/structure-lab.html`);
  await page.click("#add-script");
  await hasEvent(e => e.reason === "script-origin-added");
  const popupPromise = context.waitForEvent("page");
  await worker.evaluate(async id => { await chrome.tabs.create({url: `chrome-extension://${id}/popup.html`, active: false}); }, extensionId);
  const popup = await popupPromise;
  try {
    await popup.waitForLoadState();
    await popup.setViewportSize({width: 320, height: 440});
    await popup.click("#structure-tab");
    await expect(popup.locator("#structure-results")).toContainText(`GET → ${site}`);
    await expect(popup.locator("#structure-results")).toContainText(destination);
    const layout = await popup.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, navBottom: document.querySelector(".panel-nav").getBoundingClientRect().bottom, height: innerHeight}));
    expect(layout.scroll).toBe(layout.width);
    expect(layout.navBottom).toBeLessThanOrEqual(layout.height);
    mkdirSync(resolve("artifacts"), {recursive: true});
    await popup.screenshot({path: resolve("artifacts/structure-popup.png")});
  } finally { await popup.close(); }
});
test("Fetch is observed, allowed by default, and only origin metadata survives", async () => {
  await input();
  const response = await page.evaluate(async destination => {
    const input = document.querySelector("input");
    Object.defineProperty(input, "value", {get() { throw new Error("Input value read"); }});
    return (await fetch(`${destination}/secret-path?card=DUMMY-CARD-SECRET`, {method: "POST", body: "DUMMY-BODY-SECRET"})).status;
  }, destination);
  expect(response).toBe(200);
  await hasEvent(e => e.kind === "fetch" && e.destination === destination);
  const stored = await worker.evaluate(async () => JSON.stringify({local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null)}));
  for (const secret of ["DUMMY-NAME-SECRET", "DUMMY-CARD-SECRET", "DUMMY-BODY-SECRET", "secret-path", "?card="]) expect(stored).not.toContain(secret);
});
test("strict mode stops Fetch, XHR, Beacon before the native request", async () => {
  await config({mode: "block", allowlist: []});
  await input();
  const requests = [];
  const watch = request => { if (request.url().startsWith(destination)) requests.push(request.url()); };
  context.on("request", watch);
  const results = await page.evaluate(async destination => {
    let fetchResult, xhrResult;
    try { await fetch(`${destination}/collect`, {method: "POST", body: "fixture"}); fetchResult = "sent"; } catch (e) { fetchResult = e.name; }
    const xhr = new XMLHttpRequest(); xhr.open("POST", `${destination}/collect`);
    try { xhr.send("fixture"); xhrResult = "sent"; } catch (e) { xhrResult = e.name; }
    return {fetchResult, xhrResult, beacon: navigator.sendBeacon(`${destination}/collect`, "fixture")};
  }, destination);
  context.off("request", watch);
  expect(results).toEqual({fetchResult: "SecurityError", xhrResult: "SecurityError", beacon: false});
  expect(requests).toHaveLength(0);
  await hasEvent(e => e.kind === "fetch" && e.blocked);
  await hasEvent(e => e.kind === "xhr" && e.blocked);
  await hasEvent(e => e.kind === "beacon" && e.blocked);
});
test("normal XHR and Beacon still forward the site's requests in observe mode", async () => {
  await input();
  await page.click("#xhr-test");
  await hasEvent(e => e.kind === "xhr" && !e.blocked);
  await page.click("#beacon-test");
  await hasEvent(e => e.kind === "beacon" && !e.blocked);
});
test("browser-side observation catches image requests without reading a payload", async () => {
  await input();
  await page.click("#image-test");
  await hasEvent(e => e.kind === "network" && e.destination === destination && !e.blocked);
});
test("form action mutation is detected even before any typing", async () => {
  await page.evaluate(() => { document.querySelector("form").action = "http://127.0.0.1:4174/collect?private=secret"; });
  await hasEvent(e => e.reason === "form-changed" && e.destination === destination && e.reasons.includes("insecure") && e.reasons.includes("form-external"));
});
test("exact allowlist exempts only the selected source and destination", async () => {
  await config({mode: "block", allowlist: [{source: site, destination}]});
  await input();
  const status = await page.evaluate(async destination => (await fetch(`${destination}/collect`, {method: "POST", body: "fixture"})).status, destination);
  expect(status).toBe(200);
  expect((await state()).events.some(e => e.destination === destination)).toBe(false);
});
test("page messages cannot change privileged settings or persist arbitrary fields", async () => {
  await page.evaluate(() => {
    window.postMessage({channel: "input-defender:v1", type: "set-settings", settings: {mode: "observe", allowlist: [{source: "*", destination: "*"}]}}, "*");
    window.postMessage({channel: "input-defender:v1", type: "incident", incident: {kind: "fetch", reason: "typing-transfer", reasons: ["typing-transfer", "PRIVATE"], destination: "https://collector.example/path?SECRET=1", categories: ["card", "PRIVATE"], value: "PRIVATE", body: "PRIVATE", source: "https://forged.example"}}, "*");
  });
  await hasEvent(e => e.destination === "https://collector.example");
  const stored = await state();
  const incident = stored.events.find(e => e.destination === "https://collector.example");
  expect(incident.source).toBe(site);
  expect(incident.categories).toEqual(["card"]);
  expect(JSON.stringify(stored)).not.toContain("PRIVATE");
  expect(JSON.stringify(stored)).not.toContain("SECRET");
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings);
  expect(settings.allowlist).toEqual([]);
});
test("popup shows events, changes mode, requires explicit exclusion, clears records", async () => {
  await input();
  await page.click("#fetch-test");
  await hasEvent(e => e.kind === "fetch");
  const popupPromise = context.waitForEvent("page");
  await worker.evaluate(async id => { await chrome.tabs.create({url: `chrome-extension://${id}/popup.html`, active: false}); }, extensionId);
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await popup.setViewportSize({width: 440, height: 600});
  await expect(popup.locator("#site")).toHaveText(site);
  await expect(popup.locator(".event").first()).toBeVisible();
  mkdirSync(resolve("artifacts"), {recursive: true});
  await popup.screenshot({path: resolve("artifacts/popup.png")});
  await popup.selectOption("#event-filter", "blocked");
  await expect(popup.locator("#events")).toContainText("条件に合う記録はありません");
  await popup.selectOption("#event-filter", "all");
  await popup.selectOption("#mode", "block");
  await expect(popup.locator("#mode-note")).toContainText("停止");
  await popup.locator(".allow-button").first().click();
  await expect(popup.getByRole("group", {name: "通知除外の確認", exact: true})).toBeVisible();
  expect((await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings)).allowlist).toHaveLength(0);
  await popup.getByRole("button", {name: "この組み合わせを除外", exact: true}).click();
  await expect(popup.locator("#allow-count")).toHaveText("1");
  await expect(popup.locator(".allow-button").first()).toBeDisabled();
  await popup.getByRole("tab", {name: "通知除外"}).click();
  await expect(popup.locator("#allow-panel")).toBeVisible();
  await expect(popup.locator("#allow-panel")).toContainText(destination);
  await popup.screenshot({path: resolve("artifacts/popup-exclusions.png")});
  await popup.getByRole("tab", {name: "プライバシー"}).click();
  await expect(popup.locator("#privacy-panel")).toBeVisible();
  await popup.screenshot({path: resolve("artifacts/popup-privacy.png")});
  await popup.getByRole("tab", {name: "プライバシー"}).press("Home");
  await expect(popup.getByRole("tab", {name: "検知記録"})).toHaveAttribute("aria-selected", "true");
  await popup.setViewportSize({width: 320, height: 440});
  const layout = await popup.evaluate(() => ({width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    tabsBottom: document.querySelector(".panel-nav").getBoundingClientRect().bottom,
    modeTop: document.getElementById("mode").getBoundingClientRect().top, workspaceHeight: document.getElementById("workspace").clientHeight}));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.tabsBottom).toBeLessThanOrEqual(440);
  expect(layout.modeTop).toBeGreaterThanOrEqual(0);
  expect(layout.workspaceHeight).toBeGreaterThan(100);
  await popup.screenshot({path: resolve("artifacts/popup-compact.png")});
  await popup.setViewportSize({width: 440, height: 600});
  await popup.click("#clear");
  await expect(popup.locator("#clear-impact")).toContainText("元に戻せません");
  expect(Number(await popup.locator("#event-count").textContent())).toBeGreaterThan(0);
  await popup.getByRole("button", {name: "キャンセル", exact: true}).press("Escape");
  await expect(popup.locator("#clear-confirm")).toBeHidden();
  await popup.click("#clear");
  await popup.click("#clear-yes");
  await expect(popup.locator("#event-count")).toHaveText("0");
  await expect(popup.locator("#clear")).toBeDisabled();
  expect((await worker.evaluate(async () => (await chrome.storage.local.get("settings")).settings)).allowlist).toHaveLength(1);
  await popup.screenshot({path: resolve("artifacts/popup-empty.png")});
  await popup.close();
});
test("reload removes old session events and stale input timing", async () => {
  await input();
  await page.click("#fetch-test");
  await hasEvent(e => e.kind === "fetch");
  await page.reload();
  await expect.poll(async () => (await state())?.monitoring).toBe(true);
  expect((await state()).events.some(e => e.kind === "fetch")).toBe(false);
  expect(Object.values((await state()).frames).every(f => f.lastInput === 0)).toBe(true);
});
test("Chrome's actual action popup sizes to its available window and keeps navigation visible", async () => {
  await worker.evaluate(() => chrome.action.openPopup());
  const cdp = await context.newCDPSession(page);
  const target = (await cdp.send("Target.getTargets")).targetInfos.find(t => t.url === `chrome-extension://${extensionId}/popup.html`);
  expect(target).toBeTruthy();
  const {sessionId} = await cdp.send("Target.attachToTarget", {targetId: target.targetId, flatten: false});
  let sequence = 0;
  async function call(method, params = {}) {
    const id = ++sequence;
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cdp.off("Target.receivedMessageFromTarget", listener); reject(new Error("Popup inspection timed out")); }, 5000);
      const listener = event => {
        const message = JSON.parse(event.message);
        if (event.sessionId === sessionId && message.id === id) {
          clearTimeout(timeout);
          cdp.off("Target.receivedMessageFromTarget", listener);
          resolve(message);
        }
      };
      cdp.on("Target.receivedMessageFromTarget", listener);
    });
    await cdp.send("Target.sendMessageToTarget", {sessionId, message: JSON.stringify({id, method, params})});
    return response;
  }
  try {
    const result = await call("Runtime.evaluate", {expression: `new Promise(resolve => {
      function read() {
        if (document.readyState !== "complete" || !document.documentElement.classList.contains("native-popup")) { requestAnimationFrame(read); return; }
        requestAnimationFrame(() => resolve({width: innerWidth, height: innerHeight, bodyHeight: document.body.clientHeight,
          scrollWidth: document.documentElement.scrollWidth, navBottom: document.querySelector(".panel-nav").getBoundingClientRect().bottom,
          workspaceHeight: document.getElementById("workspace").clientHeight}));
      }
      read();
    })`, awaitPromise: true, returnByValue: true});
    const layout = result.result.result.value;
    expect(layout.width).toBe(440);
    expect(layout.scrollWidth).toBe(layout.width);
    expect(layout.bodyHeight).toBeLessThanOrEqual(layout.height);
    expect(layout.navBottom).toBeLessThanOrEqual(layout.height);
    expect(layout.workspaceHeight).toBeGreaterThan(100);
    const screenshot = await call("Page.captureScreenshot", {format: "png"});
    require("node:fs").writeFileSync(resolve("artifacts/popup-native.png"), Buffer.from(screenshot.result.data, "base64"));
  } finally {
    await cdp.send("Target.closeTarget", {targetId: target.targetId});
    await cdp.detach();
  }
});
test("local attack lab actually sends edited dummy values and can stop automatic sending", async () => {
  await page.goto(`${site}/attack-lab.html`);
  await expect(page.locator("#auto-state")).toHaveText("停止中");
  await page.click("#auto-start");
  const requestPromise = page.waitForRequest(request => request.url() === `${destination}/lab/collect?kind=fetch`);
  await page.locator("#lab-name").fill("DUMMY-LAB-NAME-SECRET");
  const request = await requestPromise;
  expect(JSON.parse(request.postData()).name).toBe("DUMMY-LAB-NAME-SECRET");
  await expect(page.locator("#log")).toContainText("ローカル受信先に届き、内容は破棄されました");
  await hasEvent(e => e.kind === "fetch" && e.destination === destination && e.reasons.includes("typing-transfer") && e.reasons.includes("insecure"));
  const stored = await worker.evaluate(async () => JSON.stringify(await chrome.storage.session.get(null)));
  expect(stored).not.toContain("DUMMY-LAB-NAME-SECRET");
  await expect(page.locator("#log")).not.toContainText("DUMMY-LAB-NAME-SECRET");
  await page.click("#auto-stop");
  await expect(page.locator("#auto-state")).toHaveText("停止中");
  const unexpectedRequest = page.waitForRequest(request => request.url() === `${destination}/lab/collect?kind=fetch`, {timeout: 800}).catch(() => null);
  await page.locator("#lab-name").fill("DUMMY-SECOND-NAME");
  expect(await unexpectedRequest).toBeNull();
});
test("strict mode stops lab auto-exfiltration and the tampered form submission", async () => {
  await page.goto(`${site}/attack-lab.html`);
  await config({mode: "block", allowlist: []});
  await page.click("#auto-start");
  await page.locator("#lab-name").fill("DUMMY-BLOCKED-NAME");
  await expect(page.locator("#log")).toContainText("拡張によって送信処理が停止されました");
  await hasEvent(e => e.kind === "fetch" && e.blocked);
  await page.click("#auto-stop");
  await page.click("#lab-tamper");
  await expect(page.locator("#form-destination")).toContainText("4174");
  await hasEvent(e => e.kind === "form" && e.destination === destination);
  const nativeRequest = page.waitForRequest(request => request.url() === `${destination}/lab/collect?kind=form`, {timeout: 800}).catch(() => null);
  await page.click("#lab-submit");
  expect(await nativeRequest).toBeNull();
  await hasEvent(e => e.kind === "form" && e.destination === destination && e.blocked);
});
test("lab image and form transfers receive local acknowledgements and the page stays local", async () => {
  await page.goto(`${site}/attack-lab.html`);
  const requests = [];
  const track = request => requests.push(request.url());
  page.on("request", track);
  await page.locator("#lab-name").fill("DUMMY-IMAGE-NAME");
  await page.click("#lab-image");
  await expect(page.locator("#log")).toContainText("入力値を含むURLがローカル受信先に届き");
  await hasEvent(e => e.kind === "network" && e.destination === destination && !e.blocked);
  await page.click("#lab-tamper");
  await page.click("#lab-submit");
  await expect(page.locator("#log")).toContainText("フォーム送信: ローカル受信先に届き");
  expect(requests.every(url => url.startsWith(`${site}/`) || url.startsWith(`${destination}/`))).toBe(true);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("form-action http://127.0.0.1:4173 http://127.0.0.1:4174");
  page.off("request", track);
  mkdirSync(resolve("artifacts"), {recursive: true});
  await page.setViewportSize({width: 1200, height: 900});
  await page.screenshot({path: resolve("artifacts/attack-lab.png"), fullPage: true});
});
test("HTTP banners immediately show early transfers and form changes, and the popup lists every reason", async () => {
  await page.goto(`${site}/attack-lab.html`);
  const cdp = await context.newCDPSession(page);
  async function alertText() {
    // Accessibility includes closed shadow roots without exposing them to the page's JavaScript.
    const {nodes} = await cdp.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    function textOf(node) { return [node.name?.value || "", ...(node.childIds || []).map(id => byId.has(id) ? textOf(byId.get(id)) : "")].join(" "); }
    return nodes.filter(node => node.role?.value === "alert").map(textOf).join(" ");
  }
  async function notificationNodes() {
    const {root} = await cdp.send("DOM.getDocument", {depth: -1, pierce: true});
    const nodes = [];
    function visit(node) { nodes.push(node); for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child); }
    visit(root);
    const attribute = (node, name) => {
      const at = (node.attributes || []).indexOf(name);
      return at < 0 ? null : node.attributes[at + 1];
    };
    return {nodes, attribute, cards: nodes.filter(node => node.nodeName === "ARTICLE" && /^notice (WARNING|CRITICAL|FATAL)$/.test(attribute(node, "class") || ""))};
  }
  async function clickNode(node) {
    const {model} = await cdp.send("DOM.getBoxModel", {nodeId: node.nodeId});
    const q = model.border;
    await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
  }
  try {
    await expect.poll(alertText).toContain("暗号化されない通信（HTTP）");
    await page.click("#auto-start");
    await page.locator("#lab-name").fill("DUMMY-MULTI-REASON-NAME");
    await expect.poll(alertText, {timeout: 2000}).toContain("入力直後の外部送信（自動送信の疑い）");
    await expect.poll(alertText).toContain("暗号化されない通信（HTTP）");
    await page.click("#auto-stop");
    await page.click("#lab-tamper");
    await expect.poll(alertText, {timeout: 2000}).toContain("フォーム送信先の変更");
    const text = await alertText();
    expect(text).toContain("入力直後の外部送信（自動送信の疑い）");
    expect(text).toContain("暗号化されない通信（HTTP）");
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const stack = await notificationNodes();
    const levels = stack.cards.map(node => stack.attribute(node, "class").split(" ")[1]);
    expect(levels[0]).toBe("FATAL");
    expect(levels).toEqual([...levels].sort((a, b) => ({FATAL: 0, CRITICAL: 1, WARNING: 2}[a] - {FATAL: 0, CRITICAL: 1, WARNING: 2}[b])));
    for (const [level, expectedColor] of Object.entries({WARNING: "rgb(186, 139, 23)", CRITICAL: "rgb(182, 50, 50)", FATAL: "rgb(118, 52, 160)"})) {
      await expect.poll(async () => {
        // Asynchronous API/network reports can redraw the stack between CDP calls.
        // Reacquire the node on every attempt rather than holding an obsolete DOM id.
        const current = await notificationNodes();
        const node = current.cards.find(node => current.attribute(node, "class") === `notice ${level}`);
        if (!node) return null;
        try {
          const {computedStyle} = await cdp.send("CSS.getComputedStyleForNode", {nodeId: node.nodeId});
          return computedStyle.find(property => property.name === "border-left-color")?.value;
        } catch (error) {
          if (error.message.includes("Could not find node with given id")) return null;
          throw error;
        }
      }, {message: `${level} notification must use its assigned color`}).toBe(expectedColor);
    }
    await page.click("#lab-xhr");
    await hasEvent(event => event.kind === "xhr");
    const repeated = await notificationNodes();
    expect(repeated.cards.filter(node => repeated.attribute(node, "aria-label") === "CRITICAL · 入力直後の外部送信（自動送信の疑い）")).toHaveLength(1);
    await expect.poll(alertText).toContain("通知受信");
    mkdirSync(resolve("artifacts"), {recursive: true});
    await page.setViewportSize({width: 1200, height: 900});
    await page.screenshot({path: resolve("artifacts/multiple-warning-banner.png"), fullPage: true});
    const popupPromise = context.waitForEvent("page");
    await worker.evaluate(async id => { await chrome.tabs.create({url: `chrome-extension://${id}/popup.html`, active: false}); }, extensionId);
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.setViewportSize({width: 440, height: 600});
    const changed = popup.locator(".event").filter({hasText: "フォーム送信先の変更"}).first();
    await expect(changed).toContainText("暗号化されない通信（HTTP）");
    await expect(changed.locator(".event-reason")).toHaveCount(3);
    const early = popup.locator(".event").filter({hasText: "入力直後の外部送信（自動送信の疑い）"}).first();
    await expect(early).toContainText("暗号化されない通信（HTTP）");
    await popup.selectOption("#event-filter", "fatal");
    await expect(popup.locator(".risk")).toHaveText(["FATAL · 最優先"]);
    await popup.selectOption("#event-filter", "critical");
    await expect(popup.locator(".risk.WARNING")).toHaveCount(0);
    await popup.selectOption("#event-filter", "all");
    await popup.screenshot({path: resolve("artifacts/multiple-warning-popup.png")});
    await popup.close();
    const current = await notificationNodes();
    const dismiss = current.nodes.find(node => node.nodeName === "BUTTON" && current.attribute(node, "aria-label") === "フォーム送信先の変更の通知を閉じる");
    await clickNode(dismiss);
    await expect.poll(async () => (await alertText()).includes("FATAL · フォーム送信先の変更")).toBe(false);
    const remaining = await notificationNodes();
    expect(remaining.cards.length).toBeGreaterThan(0);
    const clearAll = remaining.nodes.find(node => node.nodeName === "BUTTON" && remaining.attribute(node, "title")?.startsWith("ページ内の通知だけを閉じます"));
    const recordCount = (await state()).events.length;
    await clickNode(clearAll);
    await expect(page.locator("[data-input-defender-notice]")).toHaveCount(0);
    expect((await state()).events.length).toBe(recordCount);
  } finally { await cdp.detach(); }
});
