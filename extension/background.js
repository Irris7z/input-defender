"use strict";
importScripts("core.js");
const Core = globalThis.InputDefenderCore;
const safari = Boolean(chrome.runtime.getManifest().browser_specific_settings?.safari);
// All access to storage goes through this worker. No sync storage or external services.
const initialized = Promise.all([
  chrome.storage.local.setAccessLevel?.({accessLevel: "TRUSTED_CONTEXTS"}),
  chrome.storage.session.setAccessLevel?.({accessLevel: "TRUSTED_CONTEXTS"})
]);
let queue = Promise.resolve();
const serialize = task => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};
const tabKey = id => `tab:${id}`;
async function settings() {
  await initialized;
  return Core.sanitizeSettings((await chrome.storage.local.get("settings")).settings);
}
function isPopup(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html"); }
function sourceOf(sender) { return Core.origin(sender.origin) || Core.origin(sender.url); }
async function stateFor(tabId) {
  return (await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] || {events: [], frames: {}, monitoring: false};
}
async function save(tabId, state) {
  await chrome.storage.session.set({[tabKey(tabId)]: state});
  const count = state.events.length;
  await chrome.action.setBadgeText?.({tabId, text: count ? String(count) : ""});
  const level = state.events.map(Core.incidentSeverity).sort((a, b) => Core.SEVERITY_RANK[a] - Core.SEVERITY_RANK[b])[0] || "WARNING";
  await chrome.action.setBadgeBackgroundColor?.({tabId, color: {WARNING: "#986300", CRITICAL: "#b63232", FATAL: "#7634a0"}[level]});
}
async function record(tabId, state, incident, config) {
  if (Core.allowed(config.allowlist, incident.source, incident.destination)) return;
  const timestamp = Date.now();
  if (state.events.some(e => e.source === incident.source && e.destination === incident.destination && Core.incidentReasons(e).join(",") === Core.incidentReasons(incident).join(",") && e.kind === incident.kind && e.blocked === incident.blocked && timestamp - e.time < 5000)) return;
  state.events.unshift({...incident, time: timestamp});
  state.events = state.events.slice(0, 100);
  await save(tabId, state);
  chrome.tabs.sendMessage(tabId, {type: "alert", incident}, {frameId: 0}).catch(() => {});
}
async function handle(message, sender) {
  await initialized;
  if (!message || typeof message.type !== "string") return {error: "Invalid request"};
  if (isPopup(sender)) {
    const tabId = message.tabId;
    if (message.type === "settings") return {settings: await settings()};
    if (message.type === "set-settings") {
      const config = Core.sanitizeSettings(message.settings);
      await chrome.storage.local.set({settings: config});
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, {type: "config-changed", settings: config}).catch(() => {});
      }
      return {settings: config};
    }
    if (!Number.isInteger(tabId) || tabId < 0) return {error: "Invalid tab"};
    if (message.type === "snapshot") return {state: await stateFor(tabId), settings: await settings()};
    if (message.type === "clear") {
      const state = await stateFor(tabId);
      state.events = [];
      await save(tabId, state);
      return {ok: true};
    }
    return {error: "Unknown request"};
  }
  if (sender.id !== chrome.runtime.id || !sender.tab || !sourceOf(sender)) return {error: "Untrusted source"};
  const tabId = sender.tab.id;
  const frameId = String(sender.frameId ?? 0);
  const source = sourceOf(sender);
  const config = await settings();
  const state = await stateFor(tabId);
  if (message.type === "config") {
    state.monitoring = true;
    if (!state.frames[frameId] || state.frames[frameId].documentId !== sender.documentId) {
      state.frames[frameId] = {source, documentId: sender.documentId, lastInput: 0, lastSubmit: 0, categories: []};
    }
    await save(tabId, state);
    return {settings: config};
  }
  const frame = state.frames[frameId] || {source, lastInput: 0, lastSubmit: 0, categories: []};
  if (message.type === "hooks-ready") {
    frame.hooksReady = true;
    state.frames[frameId] = frame;
    await chrome.storage.session.set({[tabKey(tabId)]: state});
    return {ok: true};
  }
  if (message.type === "structure") {
    const structure = Core.sanitizeStructure(message.structure);
    if (structure) {
      frame.source = source;
      frame.structure = structure;
      state.frames[frameId] = frame;
      // Bound metadata from pages containing many child frames.
      for (const id of Object.keys(state.frames).slice(100)) delete state.frames[id];
      await chrome.storage.session.set({[tabKey(tabId)]: state});
    }
    return {ok: true};
  }
  if (message.type === "activity") {
    frame.source = source;
    frame.categories = Core.categories(message.categories);
    frame.lastInput = Date.now();
    state.frames[frameId] = frame;
    await chrome.storage.session.set({[tabKey(tabId)]: state});
    return {ok: true};
  }
  if (message.type === "submit") {
    frame.lastSubmit = Date.now();
    state.frames[frameId] = frame;
    await chrome.storage.session.set({[tabKey(tabId)]: state});
    return {ok: true};
  }
  if (message.type === "incident") {
    const incident = Core.sanitizeIncident(message.incident, source);
    if (incident) await record(tabId, state, incident, config);
    return {ok: true};
  }
  return {error: "Unknown request"};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serialize(() => handle(message, sender)).then(respond, () => respond({error: "処理に失敗しました"}));
  return true;
});
// Browser-side observation also covers image loads, workers, and redirects. No requestBody access.
function observeRequest(details, redirect = false) {
  if (details.tabId < 0 || details.type === "main_frame") return;
  // Normalize immediately: paths, queries, fragments and credentials are never kept.
  const destination = Core.origin(redirect ? details.redirectUrl : details.url);
  const initiator = Core.origin(details.initiator);
  const tabId = details.tabId;
  const frameId = String(details.frameId);
  if (!destination || !initiator) return;
  serialize(async () => {
    await initialized;
    const state = await stateFor(tabId);
    const frame = state.frames[frameId];
    if (!frame || frame.source !== initiator || Date.now() - frame.lastInput > 5000) return;
    const config = await settings();
    const incident = Core.analyze({source: initiator, destination, kind: "network", categories: frame.categories,
      recentInput: true, userSubmitted: Date.now() - frame.lastSubmit <= 1500, redirect}, config);
    if (incident) await record(tabId, state, incident, config);
  }).catch(() => {});
}
// iOS requires a nonpersistent background and does not support these listeners.
if (!safari) {
  chrome.webRequest.onBeforeRequest.addListener(details => observeRequest(details), {urls: ["<all_urls>"]});
  chrome.webRequest.onBeforeRedirect.addListener(details => observeRequest(details, true), {urls: ["<all_urls>"]});
}
chrome.tabs.onRemoved.addListener(tabId => {
  serialize(() => chrome.storage.session.remove(tabKey(tabId))).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") serialize(async () => {
    await initialized;
    await save(tabId, {events: [], frames: {}, monitoring: false});
  }).catch(() => {});
});
// Browser shutdown clears session data; also discard closed tabs after extension reload.
initialized.then(() => serialize(async () => {
  const ids = new Set((await chrome.tabs.query({})).map(tab => tabKey(tab.id)));
  const all = await chrome.storage.session.get(null);
  const stale = Object.keys(all).filter(key => key.startsWith("tab:") && !ids.has(key));
  if (stale.length) await chrome.storage.session.remove(stale);
})).catch(() => {});
