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
  const REASON_ORDER = Object.freeze(["form-changed", "typing-transfer", "external-redirect", "network-after-input", "form-external", "insecure"]);
  const BLOCKING_REASONS = Object.freeze(["form-changed", "typing-transfer", "insecure"]);
  const SEVERITY_RANK = Object.freeze({FATAL: 0, CRITICAL: 1, WARNING: 2});
  function reasonSeverity(reason) {
    if (reason === "form-changed") return "FATAL";
    if (["typing-transfer", "network-after-input", "external-redirect"].includes(reason)) return "CRITICAL";
    return "WARNING";
  }
  function incidentReasons(incident) {
    const supplied = Array.isArray(incident?.reasons) ? incident.reasons.slice(0, REASON_ORDER.length) : [];
    return REASON_ORDER.filter(reason => reason === incident?.reason || supplied.includes(reason));
  }
  function incidentSeverity(incident) {
    return incidentReasons(incident).map(reasonSeverity).sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0] || "WARNING";
  }
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
    const matches = [];
    // Evaluate each behavior independently. HTTP must not hide a destination change or an early transfer.
    if (insecure && (meta.kind === "form" || meta.recentInput)) matches.push("insecure");
    if (meta.changed && meta.kind === "form") matches.push("form-changed");
    if (external && meta.recentInput && !meta.userSubmitted && meta.kind !== "network" && meta.kind !== "form") matches.push("typing-transfer");
    if (external && meta.kind === "form") matches.push("form-external");
    if (external && meta.recentInput && !meta.userSubmitted && meta.kind === "network") matches.push(meta.redirect ? "external-redirect" : "network-after-input");
    const reasons = incidentReasons({reasons: matches});
    if (!reasons.length) return null;
    const severity = incidentSeverity({reasons});
    return {source, destination, categories: fields, kind: KINDS.includes(meta.kind) ? meta.kind : "network", reason: reasons[0], reasons, severity,
      blocked: settings.mode === "block" && reasons.some(reason => BLOCKING_REASONS.includes(reason)) && meta.attempt === true && meta.kind !== "network"};
  }
  function sanitizeIncident(raw, source) {
    if (!raw || !Object.hasOwn(REASONS, raw.reason) || !KINDS.includes(raw.kind)) return null;
    const destination = origin(raw.destination);
    const fields = categories(raw.categories);
    if (!destination || !fields.length || !origin(source)) return null;
    const reasons = incidentReasons(raw);
    const severity = incidentSeverity({reasons});
    return {source: origin(source), destination, categories: fields, kind: raw.kind, reason: reasons[0], reasons,
      severity, blocked: raw.blocked === true && raw.kind !== "network" && reasons.some(reason => BLOCKING_REASONS.includes(reason))};
  }
  function sanitizeSettings(raw = {}) {
    if (!raw || typeof raw !== "object") raw = {};
    return {mode: raw.mode === "block" ? "block" : "observe", allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.slice(0, 100).flatMap(r => {
      if (!r || typeof r !== "object") return [];
      const source = origin(r.source), destination = origin(r.destination);
      return source && destination ? [{source, destination}] : [];
    }) : []};
  }
  const api = Object.freeze({CATEGORIES, REASONS, KINDS, SEVERITY_RANK, origin, categories, fieldCategory, allowed, analyze, reasonSeverity, incidentSeverity, incidentReasons, sanitizeIncident, sanitizeSettings});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.defineProperty(globalThis, "InputDefenderCore", {value: api, configurable: false, writable: false});
})();
