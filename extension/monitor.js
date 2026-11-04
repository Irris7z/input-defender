/* MAIN world. Arguments are forwarded unchanged. Bodies and input values are NEVER inspected. */
(() => {
  "use strict";
  const Core = globalThis.InputDefenderCore;
  const nativePost = window.postMessage.bind(window);
  const nativeApply = Reflect.apply;
  const now = Date.now.bind(Date);
  const source = Core.origin(location.origin);
  if (!source) return;
  let settings = {mode: "observe", allowlist: []};
  let lastInput = 0, lastSubmit = 0;
  const activeCategories = new Set();
  const xhrDestinations = new WeakMap();
  const formOrigins = new WeakMap();
  const formElements = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "elements")?.get;
  const recentReports = new Map();
  const channel = "input-defender:v1";
  let connected = false;
  const outbox = [];
  function emit(type, payload) {
    if (!connected && type !== "ready") {
      if (outbox.length < 100) outbox.push({type, payload});
      return;
    }
    nativePost({channel, type, ...payload}, "*");
  }
  function report(incident) {
    if (!incident) return false;
    const key = `${Core.incidentReasons(incident).join(",")}|${incident.kind}|${incident.destination}|${incident.blocked}`;
    if (now() - (recentReports.get(key) || 0) > 3000) {
      if (recentReports.size > 200) recentReports.clear();
      recentReports.set(key, now());
      emit("incident", {incident});
    }
    return incident.blocked;
  }
  function fieldCategory(element) {
    if (!(element instanceof Element) || !element.matches("input, textarea, select")) return null;
    // Only schema attributes. No .value, event.data, text content, or FormData access.
    return Core.fieldCategory({type: element.getAttribute("type"), autocomplete: element.getAttribute("autocomplete"), name: element.getAttribute("name"), id: element.getAttribute("id")});
  }
  function onInput(event) {
    if (!event.isTrusted) return;
    const category = fieldCategory(event.composedPath()[0]);
    if (!category) return;
    if (now() - lastInput > 5000) activeCategories.clear();
    activeCategories.add(category);
    lastInput = now();
    // Deliberately does not forward the event, target, or any event data.
    emit("activity", {categories: [...activeCategories]});
  }
  window.addEventListener("input", onInput, true);
  window.addEventListener("change", onInput, true);
  function destinationOf(target) {
    if (typeof target === "string") return Core.origin(target, document.baseURI);
    if (target instanceof URL) return Core.origin(target.href);
    if (target instanceof Request) return Core.origin(target.url);
    return null; // Do not invoke arbitrary user-defined stringification.
  }
  function check(destination, kind) {
    return report(Core.analyze({source, destination, kind, categories: [...activeCategories], recentInput: now() - lastInput <= 5000,
      userSubmitted: now() - lastSubmit <= 1500, attempt: true}, settings));
  }
  function denied() { return new DOMException("Input Defender: 不審な送信挙動を停止しました。拡張の警告を確認してください。", "SecurityError"); }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    if (check(destinationOf(args[0]), "fetch")) return Promise.reject(denied());
    return nativeApply(originalFetch, this, args);
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    const result = nativeApply(originalOpen, this, args);
    xhrDestinations.set(this, destinationOf(args[1]));
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (check(xhrDestinations.get(this), "xhr")) throw denied();
    return nativeApply(originalSend, this, args);
  };
  const originalBeacon = Navigator.prototype.sendBeacon;
  if (originalBeacon) Navigator.prototype.sendBeacon = function (...args) {
    if (check(destinationOf(args[0]), "beacon")) return false;
    return nativeApply(originalBeacon, this, args);
  };
  const originalWsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (...args) {
    if (check(Core.origin(this.url), "websocket")) throw denied();
    return nativeApply(originalWsSend, this, args);
  };
  function formCategories(form) {
    const controls = formElements ? nativeApply(formElements, form, []) : form.querySelectorAll("input, textarea, select");
    return [...new Set([...controls].map(fieldCategory).filter(Boolean))];
  }
  function inspectForm(form, attempt = false, submitter = null) {
    if (!(form instanceof HTMLFormElement)) return false;
    const fields = formCategories(form);
    // getAttribute avoids named form controls shadowing properties such as action.
    const overridden = submitter instanceof Element ? submitter.getAttribute("formaction") : null;
    const action = overridden ?? form.getAttribute("action");
    const destination = Core.origin(action || location.href, document.baseURI);
    const target = overridden === null ? form : submitter;
    const hadBaseline = formOrigins.has(target);
    const changed = hadBaseline && formOrigins.get(target) !== destination;
    // Keep the first destination as a baseline, including after mutation delivery.
    if (!hadBaseline) formOrigins.set(target, destination);
    return report(Core.analyze({source, destination, categories: fields, kind: "form", changed, attempt,
      recentInput: false, userSubmitted: true}, settings));
  }
  window.addEventListener("submit", event => {
    if (inspectForm(event.target, true, event.submitter)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else {
      lastSubmit = now();
      emit("submit", {});
    }
  }, true);
  const nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (...args) {
    if (inspectForm(this, true)) throw denied();
    lastSubmit = now();
    emit("submit", {});
    return nativeApply(nativeSubmit, this, args);
  };
  function scan(root) {
    if (root instanceof HTMLFormElement) inspectForm(root);
    if (root instanceof Element && root.matches("button[formaction], input[formaction]") && root.form) inspectForm(root.form, false, root);
    if (root.querySelectorAll) {
      for (const form of root.querySelectorAll("form")) inspectForm(form);
      // Form-associated submit buttons can override action on the form.
      for (const button of root.querySelectorAll("button[formaction], input[formaction]")) {
        if (button.form) inspectForm(button.form, false, button);
      }
    }
  }
  const pendingForms = new Set();
  let scanScheduled = false;
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.hasAttribute("formaction")) pendingForms.add(record.target);
        const form = record.target instanceof HTMLFormElement ? record.target : record.target.form;
        if (form) pendingForms.add(form);
      } else {
        const parentForm = record.target.closest?.("form");
        if (parentForm) pendingForms.add(parentForm);
        for (const node of record.addedNodes) if (node instanceof Element) pendingForms.add(node);
      }
    }
    if (!scanScheduled && pendingForms.size) {
      scanScheduled = true;
      queueMicrotask(() => { scanScheduled = false; for (const root of pendingForms) scan(root); pendingForms.clear(); });
    }
  });
  observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ["action", "formaction", "autocomplete", "type", "name", "id"]});
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.channel !== channel) return;
    if (event.data.type === "config") {
      settings = Core.sanitizeSettings(event.data.settings);
      connected = true;
      for (const item of outbox.splice(0)) emit(item.type, item.payload);
      scan(document);
    } else if (event.data.type === "ping") emit("ready", {});
  });
  scan(document);
  emit("ready", {});
})();
