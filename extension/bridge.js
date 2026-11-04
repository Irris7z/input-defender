/* ISOLATED world. This boundary forwards only a small, sanitized metadata schema. */
(() => {
  "use strict";
  const Core = globalThis.InputDefenderCore;
  const channel = "input-defender:v1";
  let lastActivity = 0;
  let banner;
  let lastBanner = 0;
  let budgetStart = Date.now(), messageCount = 0;
  const source = Core.origin(location.origin);
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);
  function configure(settings) { window.postMessage({channel, type: "config", settings: Core.sanitizeSettings(settings)}, "*"); }
  function showBanner(incident) {
    if (window !== window.top || incident.severity !== "high" || Date.now() - lastBanner < 5000) return;
    lastBanner = Date.now();
    banner?.remove();
    banner = document.createElement("div");
    banner.setAttribute("data-input-defender-notice", "");
    const shadow = banner.attachShadow({mode: "closed"});
    const style = document.createElement("style");
    style.textContent = `:host{all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;width:min(400px,calc(100vw - 24px))!important}*{box-sizing:border-box}.notice{padding:14px 16px;color:#263c32;background:#fff;border:1px solid #dcc4a3;border-left:4px solid #ad513e;border-radius:6px;box-shadow:0 4px 20px #0002;font:12px/1.7 system-ui,sans-serif;max-height:calc(100dvh - 24px);overflow:auto}strong{display:block;font-size:13px;color:#973f2f;margin-bottom:6px}p{margin:6px 0;overflow-wrap:anywhere}.small{font-size:11px;color:#5e6d63}.next{font-weight:600}button{background:#fff;border:1px solid #bfcbbf;border-radius:5px;color:#355440;padding:5px 10px;min-height:30px;font:11px/1.6 system-ui,sans-serif;cursor:pointer}button:focus-visible{outline:2px solid #285b40;outline-offset:2px}`;
    const box = document.createElement("div");
    box.className = "notice";
    box.setAttribute("role", "alert");
    const title = document.createElement("strong");
    title.textContent = incident.blocked ? "Input Defender · 送信処理を停止しました" : "Input Defender · 確認が必要な動きを検知";
    const reason = document.createElement("p");
    reason.textContent = globalThis.InputDefenderUI.reasons[incident.reason];
    const destination = document.createElement("p");
    destination.textContent = `送信先: ${incident.destination}`;
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = "入力内容は確認していません。漏えいや悪意を断定する警告ではありません。";
    const next = document.createElement("p");
    next.className = "next";
    next.textContent = "拡張アイコンを開き、「検知記録」で送信先を確認してください。";
    const close = document.createElement("button");
    close.textContent = "警告を閉じる";
    close.title = "この警告だけを閉じます。監視は続きます。";
    close.addEventListener("click", () => banner?.remove());
    box.addEventListener("keydown", event => { if (event.key === "Escape") banner?.remove(); });
    box.append(title, reason, destination, next, note, close);
    shadow.append(style, box);
    (document.body || document.documentElement)?.append(banner);
  }
  window.addEventListener("message", async event => {
    if (event.source !== window || event.data?.channel !== channel) return;
    if (Date.now() - budgetStart >= 1000) { budgetStart = Date.now(); messageCount = 0; }
    if (++messageCount > 40) return;
    if (event.data.type === "ready") {
      const response = await send({type: "config"});
      if (response) configure(response.settings);
    } else if (event.data.type === "activity") {
      if (Date.now() - lastActivity < 250) return;
      const categories = Core.categories(event.data.categories);
      if (!categories.length) return;
      lastActivity = Date.now();
      await send({type: "activity", categories});
    } else if (event.data.type === "submit") {
      await send({type: "submit"});
    } else if (event.data.type === "incident") {
      const incident = Core.sanitizeIncident(event.data.incident, source);
      if (incident) await send({type: "incident", incident});
    }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === "config-changed") configure(message.settings);
    if (message.type === "alert") {
      const incident = Core.sanitizeIncident(message.incident, message.incident?.source);
      if (incident) showBanner(incident);
    }
  });
  window.postMessage({channel, type: "ping"}, "*");
})();
