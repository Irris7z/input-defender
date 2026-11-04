"use strict";
const Core = globalThis.InputDefenderCore;
const UI = globalThis.InputDefenderUI;
const $ = id => document.getElementById(id);
let tabId;
let config = {mode: "observe", allowlist: []};
let currentEvents = [];
let activeUrl = null;
let working = false;
let loaded = false;
let renderedEvents = "";
let renderedRules = "";
let renderedStructure = "";
// An extension tab can resize; Chrome's actual action popup needs intrinsic dimensions.
chrome.tabs.getCurrent().then(tab => {
  if (!tab) document.documentElement.classList.add("native-popup");
}).catch(() => {});
const send = async message => {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.error) throw new Error("処理できませんでした。拡張を開き直して、もう一度お試しください。");
  return response;
};
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function message(text, error = false) {
  $("message").textContent = text;
  $("message").hidden = !text;
  $("message").classList.toggle("error", error);
  $("message").setAttribute("role", error ? "alert" : "status");
}
function syncControls() {
  $("mode").disabled = !loaded || working;
  $("clear").disabled = working || !currentEvents.length;
  $("clear").title = !currentEvents.length ? "削除する記録はありません" : "このタブの検知記録だけを削除します";
  document.querySelectorAll(".allow-button, .rule button, .confirm-box button").forEach(button => {
    button.disabled = working || button.dataset.excluded === "true";
  });
}
function cancelExclusion(focus = false) {
  const box = $("events").querySelector(".confirm-box");
  if (!box) return;
  const opener = box.closest(".event").querySelector(".allow-button");
  box.remove();
  opener.setAttribute("aria-expanded", "false");
  if (focus) opener.focus();
}
function closeClear(focus = false) {
  $("clear-confirm").hidden = true;
  $("clear").setAttribute("aria-expanded", "false");
  if (focus && !$("clear").disabled) $("clear").focus();
}
function switchPanel(tab, focus = false) {
  cancelExclusion();
  closeClear();
  document.querySelectorAll('[role="tab"]').forEach(button => {
    const selected = button === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !selected;
  });
  $("workspace").scrollTop = 0;
  if (focus) tab.focus();
}
async function saveConfig(next) {
  config = (await send({type: "set-settings", settings: next})).settings;
  renderSettings();
  renderEvents();
}
function renderSettings() {
  $("mode").value = config.mode;
  $("mode-note").textContent = config.mode === "block"
    ? "対応する送信処理だけを停止します。決済や住所補完も止まる場合があります。"
    : "通信を止めず、不審な動きを記録して警告します。";
  $("allow-count").textContent = String(config.allowlist.length);
  const signature = JSON.stringify(config.allowlist);
  if (signature === renderedRules) return;
  renderedRules = signature;
  const root = $("allow-rules");
  root.replaceChildren();
  if (!config.allowlist.length) {
    const empty = element("div", "empty");
    empty.append(element("strong", "", "通知除外はありません"), document.createTextNode("必要な場合だけ、検知記録の送信先から追加できます。"));
    root.append(empty);
  }
  for (const rule of config.allowlist) {
    const row = element("div", "rule");
    row.append(element("div", "rule-pair", `元ページ: ${rule.source}`), element("div", "rule-pair", `送信先: ${rule.destination}`));
    const actions = element("div", "button-row");
    const remove = element("button", "button secondary", "除外を解除");
    remove.setAttribute("aria-label", `${rule.destination} の通知除外を解除`);
    remove.addEventListener("click", () => run(async () => {
      await saveConfig({...config, allowlist: config.allowlist.filter(r => r.source !== rule.source || r.destination !== rule.destination)});
      message("通知除外を解除しました。次に検知した動きから警告します。");
    }));
    actions.append(remove);
    row.append(actions);
    root.append(row);
  }
}
function showExclusion(card, event, opener) {
  if (card.querySelector(".confirm-box")) { cancelExclusion(true); return; }
  cancelExclusion();
  closeClear();
  const confirm = element("div", "confirm-box");
  confirm.setAttribute("role", "group");
  confirm.setAttribute("aria-label", "通知除外の確認");
  confirm.append(element("h3", "", "この組み合わせの警告を除外しますか？"),
    element("p", "pair", `元ページ: ${event.source}`), element("p", "pair", `送信先: ${event.destination}`),
    element("p", "", "この組み合わせの警告と送信の停止が解除されます。信頼できる場合だけ追加してください。通知除外の一覧から解除できます。"));
  const actions = element("div", "button-row");
  const yes = element("button", "button primary", "この組み合わせを除外");
  const cancel = element("button", "button secondary", "キャンセル");
  yes.addEventListener("click", () => run(async () => {
    if (!Core.allowed(config.allowlist, event.source, event.destination)) {
      if (config.allowlist.length >= 100) throw new Error("通知除外は100件までです。一覧で不要な除外を解除してください。");
      await saveConfig({...config, allowlist: [...config.allowlist, {source: event.source, destination: event.destination}]});
    }
    renderEvents(true);
    message("通知除外を保存しました。停止した操作は再送しません。");
  }));
  cancel.addEventListener("click", () => cancelExclusion(true));
  actions.append(yes, cancel);
  confirm.append(actions);
  card.append(confirm);
  opener.setAttribute("aria-expanded", "true");
  confirm.scrollIntoView({block: "nearest"});
  // Focus the reversible choice first, so keyboard activation does not exclude accidentally.
  cancel.focus({preventScroll: true});
}
function renderEvents(force = false) {
  const filter = $("event-filter").value;
  const signature = JSON.stringify([currentEvents, config.allowlist, filter]);
  const root = $("events");
  if (!force && (root.querySelector(".confirm-box") || signature === renderedEvents)) return;
  renderedEvents = signature;
  const events = currentEvents.filter(event => filter === "critical" ? Core.incidentSeverity(event) !== "WARNING" : filter === "fatal" ? Core.incidentSeverity(event) === "FATAL" : filter === "blocked" ? event.blocked : true);
  root.replaceChildren();
  if (!events.length) {
    const empty = element("div", "empty");
    empty.append(element("strong", "", currentEvents.length ? "条件に合う記録はありません" : "検知記録はありません"),
      document.createTextNode(currentEvents.length ? "表示を「すべて」にすると全件を確認できます。" : "不審な動きがあれば、ここに表示します。"));
    root.append(empty);
  }
  for (const event of events) {
    const level = Core.incidentSeverity(event);
    const card = element("article", `event ${level}`);
    const head = element("div", "event-head");
    head.append(element("span", `risk ${level}`, UI.levels[level]), element("span", "kind", UI.kinds[event.kind]),
      element("time", "time", new Date(event.time).toLocaleTimeString("ja-JP", {hour: "2-digit", minute: "2-digit", second: "2-digit"})));
    const reasons = element("ul", "event-reasons");
    for (const reason of Core.incidentReasons(event)) {
      const row = element("li", `event-reason ${Core.reasonSeverity(reason)}`);
      row.append(element("strong", "reason-label", UI.labels[reason]), element("p", "", UI.reasons[reason]));
      reasons.append(row);
    }
    card.append(head, reasons, element("div", "destination", `送信先: ${event.destination}`));
    if (event.source !== activeUrl) card.append(element("div", "source", `ページ内の元ページ: ${event.source}`));
    card.append(element("div", "tags", `入力欄の種類: ${event.categories.map(c => Core.CATEGORIES[c]).join(" / ")}`));
    const bottom = element("div", "event-bottom");
    bottom.append(element("span", `outcome ${event.blocked ? "blocked" : ""}`, event.blocked ? "送信処理を停止" : ["script", "frame"].includes(event.kind) ? "構造の変化を観測・停止対象外" : event.kind === "network" ? "通信先を観測・停止対象外" : event.kind === "form" ? "フォームを確認・停止なし" : "送信処理を検知・停止なし"));
    const excluded = Core.allowed(config.allowlist, event.source, event.destination);
    const allow = element("button", "button secondary allow-button", excluded ? "除外済み" : "この送信先の警告を除外…");
    allow.dataset.excluded = String(excluded);
    allow.disabled = excluded;
    allow.title = excluded ? "この組み合わせはすでに通知除外されています。一覧から解除できます。" : "信頼できる送信先だけを除外してください";
    allow.setAttribute("aria-expanded", "false");
    allow.addEventListener("click", () => showExclusion(card, event, allow));
    bottom.append(allow);
    card.append(bottom);
    root.append(card);
  }
  syncControls();
}
function renderStructure(frames) {
  const signature = JSON.stringify(frames);
  if (signature === renderedStructure) return;
  renderedStructure = signature;
  const root = $("structure-results");
  root.replaceChildren();
  const entries = Object.entries(frames || {}).filter(([, frame]) => frame.structure);
  if (!entries.length) root.append(element("div", "empty", "構造情報はまだありません。通常のWebページを再読み込みしてください。"));
  for (const [id, frame] of entries) {
    const data = Core.sanitizeStructure(frame.structure);
    const card = element("article", "structure-frame");
    card.append(element("h3", "", `${id === "0" ? "メインページ" : "埋め込みページ"}: ${frame.source}`),
      element("p", "caption", `${data.complete ? "初期DOMの読み込み済み・変更を監視中" : "初期DOMを読み込み中"}${data.truncated ? " / 上限により一部省略" : ""}`),
      element("p", "", `個人情報用の欄 ${data.sensitiveFieldCount}件 / フォーム ${data.formCount}件（個人情報用 ${data.sensitiveFormCount}件）`),
      element("p", "caption", `入力欄の種類: ${data.categories.map(c => Core.CATEGORIES[c]).join(" / ") || "未分類"}`),
      element("h3", "", "個人情報用フォームの送信先・送信方法"));
    if (!data.forms.length) card.append(element("p", "caption", "HTTP(S)の送信先を持つ個人情報用フォームは見つかっていません。"));
    for (const form of data.forms) {
      const row = element("div", "structure-row", `${form.method} → ${form.destination}`);
      row.append(element("span", "", `${form.categories.map(c => Core.CATEGORIES[c]).join(" / ")} · 設定 ${form.count}件（送信ボタンの上書きを含む）`));
      card.append(row);
    }
    card.append(element("h3", "", `外部スクリプト ${data.externalScriptCount}件 / src属性付き ${data.scriptCount}件`));
    if (!data.scripts.length) card.append(element("p", "caption", "外部のHTTP(S)参照元は見つかっていません。"));
    for (const script of data.scripts) {
      const row = element("div", "structure-row", script.origin);
      row.append(element("span", "", `${script.count}件 / integrity属性あり ${script.integrityCount}件（属性の有無のみ・内容は検証しません）`));
      card.append(row);
    }
    card.append(element("h3", "", `埋め込みフレーム ${data.frameCount}件`));
    for (const frame of data.frames) card.append(element("div", "structure-row", `${frame.origin} · ${frame.count}件`));
    if (data.opaqueFrameCount) card.append(element("p", "caption", `srcdoc・about:blankなど、HTTP(S)参照先に分類できないもの ${data.opaqueFrameCount}件`));
    card.append(element("p", "caption", "インラインスクリプト、スクリプト内部の追加読込、Shadow DOM内部などはこの一覧の対象外です。"));
    root.append(card);
  }
}
async function refresh() {
  if (!Number.isInteger(tabId)) return;
  const {state, settings} = await send({type: "snapshot", tabId});
  config = settings;
  currentEvents = state.events;
  loaded = true;
  renderSettings();
  $("event-count").textContent = String(currentEvents.length);
  $("destination-count").textContent = String(new Set(currentEvents.map(e => e.destination)).size);
  const status = document.querySelector(".status");
  const highest = currentEvents.map(Core.incidentSeverity).sort((a, b) => Core.SEVERITY_RANK[a] - Core.SEVERITY_RANK[b])[0];
  status.className = `status${!state.monitoring ? " unavailable" : highest ? ` ${highest}` : ""}`;
  $("status-label").textContent = !state.monitoring ? "このページは監視できていません" : currentEvents.length ? "確認が必要な記録があります" : "監視中・検知記録なし";
  $("status-note").textContent = !state.monitoring
    ? "通常のWebページを開き、再読み込みしてください。Chromeの設定画面などは監視できません。"
    : currentEvents.length ? "身に覚えのない送信先がないか、検知記録を確認してください。"
    : "操作は不要です。不審な動きがあれば警告します。安全を保証する表示ではありません。";
  renderEvents();
  renderStructure(state.frames);
  syncControls();
}
async function run(task) {
  if (working) return;
  working = true;
  syncControls();
  message("");
  try { await task(); }
  catch (error) { message(error.message, true); renderSettings(); }
  finally { working = false; syncControls(); }
}
$("mode").addEventListener("change", () => run(async () => {
  await saveConfig({...config, mode: $("mode").value});
  message("監視モードを保存しました。停止した操作は自動で再送しません。");
}));
$("event-filter").addEventListener("change", () => { cancelExclusion(); renderEvents(true); });
$("clear").setAttribute("aria-controls", "clear-confirm");
$("clear").setAttribute("aria-expanded", "false");
$("clear").addEventListener("click", () => {
  cancelExclusion();
  $("clear-impact").textContent = `このタブの検知記録${currentEvents.length}件を削除します。監視モードと通知除外は変わりません。削除した記録は元に戻せません。`;
  $("clear-confirm").hidden = false;
  $("clear").setAttribute("aria-expanded", "true");
  $("clear-cancel").focus();
});
$("clear-cancel").addEventListener("click", () => closeClear(true));
$("clear-yes").addEventListener("click", () => run(async () => {
  await send({type: "clear", tabId});
  closeClear();
  await refresh();
  message("このタブの記録を削除しました。監視モードと通知除外は維持しています。");
}));
const tabs = [...document.querySelectorAll('[role="tab"]')];
for (const tab of tabs) {
  tab.addEventListener("click", () => switchPanel(tab));
  tab.addEventListener("keydown", event => {
    const index = tabs.indexOf(tab);
    const target = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : null;
    if (target) { event.preventDefault(); switchPanel(target, true); }
  });
}
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  cancelExclusion(true);
  closeClear(true);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[`tab:${tabId}`] && !working) refresh().catch(() => message("記録を更新できませんでした。拡張を開き直してください。", true));
});
run(async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  tabId = tab?.id;
  activeUrl = Core.origin(tab?.url);
  $("site").textContent = activeUrl || "監視対象外のページ";
  if (Number.isInteger(tabId)) await refresh();
  else {
    $("status-label").textContent = "ページを確認できませんでした";
    $("status-note").textContent = "通常のWebページを開き、拡張を開き直してください。";
  }
});
