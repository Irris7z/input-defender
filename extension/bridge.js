/* ISOLATED world. This boundary forwards only a small, sanitized metadata schema. */
(() => {
  "use strict";
  const Core = globalThis.InputDefenderCore;
  const channel = "input-defender:v1";
  let lastActivity = 0;
  const UI = globalThis.InputDefenderUI;
  const notices = new Map();
  let noticeSequence = 0, omittedCount = 0;
  let stack, stackShadow, stackList, stackCount, omittedNote;
  let budgetStart = Date.now(), messageCount = 0;
  const source = Core.origin(location.origin);
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);
  let structure;
  function configure(settings) {
    const config = Core.sanitizeSettings(settings);
    if (structure) structure.configure(config);
    else structure = globalThis.InputDefenderStructure.start(send, config);
    window.postMessage({channel, type: "config", settings: config}, "*");
  }
  function ensureStack() {
    if (stack?.isConnected) return;
    stack = document.createElement("div");
    stack.setAttribute("data-input-defender-notice", "");
    const shadow = stack.attachShadow({mode: "closed"});
    stackShadow = shadow;
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;width:min(420px,calc(100vw - 24px))!important}
      *{box-sizing:border-box}
      .stack{display:flex;flex-direction:column;max-height:min(720px,calc(100dvh - 24px));background:#fff;border:1px solid #cbd5c9;border-radius:7px;box-shadow:0 4px 22px #0003;color:#273a30;font:12px/1.6 system-ui,sans-serif;overflow:hidden}
      .header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #dfe5da;flex-shrink:0}
      .header strong{font-size:12px}.header span{color:#596b5b;font-size:11px}
      .list{min-height:0;overflow:auto;padding:9px;scrollbar-width:thin}
      .notice{border:1px solid #dedfd5;border-left:4px solid #ba8b17;border-radius:5px;padding:10px;margin-bottom:8px;background:#fffdf3}
      .notice:last-child{margin-bottom:0}
      .notice.CRITICAL{border-left-color:#b63232;background:#fff7f7}
      .notice.FATAL{border-left-color:#7634a0;background:#fcf8ff}
      .row{display:flex;align-items:center;gap:8px}.level{font-size:10px;font-weight:750;color:#785200;background:#fff2c6;border-radius:3px;padding:2px 5px}
      .CRITICAL .level{color:#a32929;background:#fde8e8}.FATAL .level{color:#6a268f;background:#f1e6fa}
      .row button{margin-left:auto;min-width:28px;padding:1px 6px;font-size:16px}
      h3{font-size:12px;line-height:1.6;margin:5px 0}
      p{margin:5px 0;overflow-wrap:anywhere}.destination,.meta{font-size:11px;color:#526351}.outcome{font-size:11px;font-weight:650}
      .footer{padding:7px 12px 10px;border-top:1px solid #dfe5da;flex-shrink:0;font-size:10px;color:#5b6b5d}.footer p{margin:3px 0}
      button{background:#fff;border:1px solid #bfcbbf;border-radius:5px;color:#355440;min-height:28px;padding:4px 8px;font:11px/1.6 system-ui,sans-serif;cursor:pointer}
      button:focus-visible{outline:2px solid #285b40;outline-offset:2px}
    `;
    const box = document.createElement("section");
    box.className = "stack";
    box.setAttribute("aria-label", "Input Defenderの検知通知");
    const header = document.createElement("div");
    header.className = "header";
    const heading = document.createElement("strong");
    heading.textContent = "Input Defender · 検知通知";
    stackCount = document.createElement("span");
    const clear = document.createElement("button");
    clear.textContent = "すべて閉じる";
    clear.title = "ページ内の通知だけを閉じます。監視と検知記録は残ります。";
    clear.addEventListener("click", () => { notices.clear(); omittedCount = 0; stack.remove(); });
    header.append(heading, stackCount, clear);
    stackList = document.createElement("div");
    stackList.className = "list";
    const footer = document.createElement("div");
    footer.className = "footer";
    const instruction = document.createElement("p");
    instruction.textContent = "詳細は拡張アイコンの「検知記録」へ。閉じても監視は続きます。";
    const limitation = document.createElement("p");
    limitation.textContent = "深刻度は挙動からの推定です。FATALでも漏えいの確定ではありません。入力内容は確認していません。";
    omittedNote = document.createElement("p");
    footer.append(instruction, limitation, omittedNote);
    box.append(header, stackList, footer);
    shadow.append(style, box);
    (document.body || document.documentElement)?.append(stack);
  }
  function sortedNotices() {
    return [...notices.values()].sort((a, b) => Core.SEVERITY_RANK[a.level] - Core.SEVERITY_RANK[b.level] || b.sequence - a.sequence);
  }
  function renderNotices(jumpToTop = false) {
    if (!notices.size) { stack?.remove(); return; }
    ensureStack();
    const scroll = stackList.scrollTop;
    const focusedKey = stackShadow.activeElement?.getAttribute("data-close-key");
    const rows = [];
    for (const notice of sortedNotices()) {
      const card = document.createElement("article");
      card.className = `notice ${notice.level}`;
      card.setAttribute("role", "alert");
      card.setAttribute("aria-label", `${notice.level} · ${UI.labels[notice.reason]}`);
      const row = document.createElement("div");
      row.className = "row";
      const level = document.createElement("span");
      level.className = "level";
      level.textContent = UI.levels[notice.level];
      const count = document.createElement("span");
      count.className = "meta";
      count.textContent = notice.count > 1 ? `通知受信 ${notice.count}回` : "";
      const close = document.createElement("button");
      close.textContent = "×";
      close.setAttribute("data-close-key", notice.key);
      close.setAttribute("aria-label", `${UI.labels[notice.reason]}の通知を閉じる`);
      close.title = "この通知だけを閉じます。監視と検知記録は残ります。";
      close.addEventListener("click", () => {
        notices.delete(notice.key);
        renderNotices();
        stackList?.querySelector("button")?.focus({preventScroll: true});
      });
      row.append(level, count, close);
      const label = document.createElement("h3");
      label.textContent = UI.labels[notice.reason];
      const description = document.createElement("p");
      description.textContent = UI.reasons[notice.reason];
      const destination = document.createElement("p");
      destination.className = "destination";
      destination.textContent = `送信先: ${notice.destination}`;
      card.append(row, label, description, destination);
      if (notice.source !== source) {
        const frame = document.createElement("p");
        frame.className = "destination";
        frame.textContent = `元ページ: ${notice.source}`;
        card.append(frame);
      }
      const outcome = document.createElement("p");
      outcome.className = "outcome";
      outcome.textContent = notice.blocked ? "対応する送信処理に停止記録があります。" : notice.kind === "network" ? "通信の観測のみ・停止対象外" : "送信の停止は行っていません。";
      card.append(outcome);
      rows.push(card);
    }
    stackList.replaceChildren(...rows);
    stackCount.textContent = `${notices.size}件`;
    omittedNote.textContent = omittedCount ? `表示上限20件のため省略した通知: ${omittedCount}件。検知記録から確認できます。` : "";
    if (focusedKey) [...stackList.querySelectorAll("button")].find(button => button.getAttribute("data-close-key") === focusedKey)?.focus({preventScroll: true});
    stackList.scrollTop = jumpToTop ? 0 : scroll;
  }
  function showBanner(incident) {
    if (window !== window.top) return;
    const previousPriority = sortedNotices()[0]?.level;
    let newUrgent = false;
    for (const reason of Core.incidentReasons(incident)) {
      const key = `${reason}|${incident.source}|${incident.destination}`;
      const previous = notices.get(key);
      const level = Core.reasonSeverity(reason);
      const blocked = incident.blocked || previous?.blocked === true;
      notices.set(key, {key, reason, level, source: incident.source, destination: incident.destination,
        kind: incident.blocked || !previous?.blocked ? incident.kind : previous.kind,
        blocked, count: (previous?.count || 0) + 1, sequence: previous?.sequence || ++noticeSequence});
      if (!previous && (level === "FATAL" || !previousPriority || Core.SEVERITY_RANK[level] < Core.SEVERITY_RANK[previousPriority])) newUrgent = true;
    }
    // Keep the highest-priority cards visible and bound page-local metadata.
    for (const entry of sortedNotices().slice(20)) { notices.delete(entry.key); omittedCount++; }
    renderNotices(newUrgent);
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
  // Structure analysis must start even if the page suppresses MAIN-world messages.
  send({type: "config"}).then(response => { if (response && !structure) configure(response.settings); });
})();
