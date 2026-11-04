/* Pure metadata rules. Never accepts an input value or a request body. */
(() => {
  "use strict";
  const CATEGORIES = Object.freeze({name: "氏名", address: "住所", card: "カード関連", email: "メール", phone: "電話番号", password: "パスワード"});
  const REASONS = Object.freeze({
    "form-external": "個人情報用フォームの送信先が別オリジンです。正規の決済や連携でも起こります。",
    "form-changed": "個人情報用フォームの送信先が読み込み後に変更されました。",
    "insecure": "個人情報用フォームに関係する、暗号化されない送信先です。",
    "typing-transfer": "個人情報用の欄への入力から5秒以内に、外部への送信APIが呼ばれました。",
    "network-after-input": "個人情報用の欄への入力から5秒以内に、外部リクエストが観測されました。本文は確認していません。",
    "external-redirect": "入力直後の通信が、別オリジンへリダイレクトされました。本文は確認していません。"
  });
  const KINDS = Object.freeze(["form", "fetch", "xhr", "beacon", "websocket", "network"]);
  function origin(raw, base) {
    if (typeof raw !== "string" || raw.length > 65536) return null;
    try {
      const u = new URL(raw, base);
      if (!["https:", "http:", "wss:", "ws:"].includes(u.protocol)) return null;
      // HTTP and WebSocket transports share an origin for our comparison.
      u.protocol = u.protocol === "wss:" ? "https:" : u.protocol === "ws:" ? "http:" : u.protocol;
      return u.origin.length <= 512 ? u.origin : null;
    } catch { return null; }
  }
  function categories(items) {
    return Array.isArray(items) ? [...new Set(items.filter(x => Object.hasOwn(CATEGORIES, x)))].slice(0, 6) : [];
  }
  function fieldCategory(meta) {
    const type = String(meta.type || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "checkbox", "radio", "file"].includes(type)) return null;
    const auto = String(meta.autocomplete || "").toLowerCase().split(/\s+/);
    const id = `${meta.name || ""} ${meta.id || ""}`.toLowerCase();
    if (type === "password" || auto.some(x => /^(current|new)-password$/.test(x))) return "password";
    if (auto.some(x => /^cc-/.test(x)) || /card.?number|credit.?card|cc.?num|cvc|cvv|カード|セキュリティコード/.test(id)) return "card";
    if (auto.some(x => /^(street-address|address-line[123]|postal-code|address-level[1-4]|country|country-name)$/.test(x)) || /address|postal|zip.?code|住所|郵便/.test(id)) return "address";
    if (type === "email" || auto.includes("email") || /e.?mail|メール/.test(id)) return "email";
    if (type === "tel" || auto.some(x => /^tel($|-)/.test(x)) || /phone|telephone|電話/.test(id)) return "phone";
    if (auto.some(x => /^(name|given-name|family-name|additional-name)$/.test(x)) || /(^|[\s_-])(full.?name|first.?name|last.?name|given.?name|family.?name|name)([\s_-]|$)|氏名|姓名/.test(id)) return "name";
    return null;
  }
  function allowed(rules, source, destination) {
    return Array.isArray(rules) && rules.some(r => r.source === source && r.destination === destination);
  }
  function analyze(meta, settings = {}) {
    const source = origin(meta.source);
    const destination = origin(meta.destination, source);
    const fields = categories(meta.categories);
    if (!source || !destination || !fields.length || allowed(settings.allowlist, source, destination)) return null;
    const external = source !== destination;
    const insecure = destination.startsWith("http:");
    let reason, severity;
    if (insecure && (meta.kind === "form" || meta.recentInput)) [reason, severity] = ["insecure", "high"];
    else if (meta.changed && meta.kind === "form") [reason, severity] = ["form-changed", "high"];
    else if (external && meta.recentInput && !meta.userSubmitted && meta.kind !== "network") [reason, severity] = ["typing-transfer", "high"];
    else if (external && meta.kind === "form") [reason, severity] = ["form-external", "medium"];
    else if (external && meta.recentInput && !meta.userSubmitted && meta.kind === "network") [reason, severity] = ["network-after-input", "medium"];
    else return null;
    return {source, destination, categories: fields, kind: KINDS.includes(meta.kind) ? meta.kind : "network", reason, severity,
      blocked: settings.mode === "block" && severity === "high" && meta.attempt === true && meta.kind !== "network"};
  }
  function sanitizeIncident(raw, source) {
    if (!raw || !Object.hasOwn(REASONS, raw.reason) || !KINDS.includes(raw.kind)) return null;
    const destination = origin(raw.destination);
    const fields = categories(raw.categories);
    if (!destination || !fields.length || !origin(source)) return null;
    return {source: origin(source), destination, categories: fields, kind: raw.kind, reason: raw.reason,
      severity: ["insecure", "form-changed", "typing-transfer"].includes(raw.reason) ? "high" : "medium", blocked: raw.blocked === true && raw.kind !== "network"};
  }
  function sanitizeSettings(raw = {}) {
    if (!raw || typeof raw !== "object") raw = {};
    return {mode: raw.mode === "block" ? "block" : "observe", allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.slice(0, 100).flatMap(r => {
      if (!r || typeof r !== "object") return [];
      const source = origin(r.source), destination = origin(r.destination);
      return source && destination ? [{source, destination}] : [];
    }) : []};
  }
  const api = Object.freeze({CATEGORIES, REASONS, KINDS, origin, categories, fieldCategory, allowed, analyze, sanitizeIncident, sanitizeSettings});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "InputDefenderCore", {value: api, configurable: false, writable: false});
})();
