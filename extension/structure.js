/* ISOLATED world: inspect schema attributes only, independently of page API hooks. */
(() => {
  "use strict";
  const Core = globalThis.InputDefenderCore;
  function start(send, initialSettings) {
    const source = Core.origin(location.origin);
    if (!source) return {configure() {}};
    let settings = Core.sanitizeSettings(initialSettings);
    let sealed = false, scheduled = false, signature = "";
    const seenScripts = new Set(), seenFrames = new Set(), reported = new Set();
    const formOrigins = new WeakMap();
    const limit = 10000;
    function report(meta) {
      const incident = Core.analyze({source, ...meta, recentInput: false, attempt: false}, settings);
      if (!incident) return;
      const key = JSON.stringify(incident);
      if (reported.has(key) || reported.size >= 200) return;
      reported.add(key);
      send({type: "incident", incident});
    }
    function scan() {
      scheduled = false;
      let truncated = false, visited = 0;
      const nodes = selector => {
        const result = [];
        for (const node of document.querySelectorAll(selector)) {
          if (++visited > limit) { truncated = true; break; }
          result.push(node);
        }
        return result;
      };
      const forms = nodes("form"), fields = nodes("input,textarea,select");
      const byForm = new Map(), categories = new Set();
      let sensitiveFieldCount = 0;
      for (const field of fields) {
        const category = Core.fieldCategory({type: field.getAttribute("type"), autocomplete: field.getAttribute("autocomplete"), name: field.getAttribute("name"), id: field.getAttribute("id")});
        if (!category) continue;
        sensitiveFieldCount++;
        categories.add(category);
        if (field.form) {
          if (!byForm.has(field.form)) byForm.set(field.form, new Set());
          byForm.get(field.form).add(category);
        }
      }
      const formRows = new Map();
      function inspectForm(form, submitter = null) {
        const fields = [...(byForm.get(form) || [])];
        if (!fields.length) return;
        const overridden = submitter?.getAttribute("formaction") ?? null;
        const destination = Core.origin((overridden ?? form.getAttribute("action")) || location.href, document.baseURI);
        const method = Core.formMethod(submitter?.getAttribute("formmethod") ?? form.getAttribute("method"));
        const target = overridden === null ? form : submitter;
        const changed = formOrigins.has(target) && formOrigins.get(target) !== destination;
        if (!formOrigins.has(target)) formOrigins.set(target, destination);
        if (!destination || method === "DIALOG") return;
        const key = JSON.stringify([destination, method, fields]);
        const row = formRows.get(key) || {destination, method, categories: fields, count: 0};
        row.count++;
        formRows.set(key, row);
        report({kind: "form", destination, method, categories: fields, changed});
      }
      for (const form of forms) inspectForm(form);
      for (const button of nodes("button[formaction],input[formaction],button[formmethod],input[formmethod]")) {
        const type = (button.getAttribute("type") || (button.localName === "button" ? "submit" : "text")).toLowerCase();
        if (button.form && ["submit", "image"].includes(type)) inspectForm(button.form, button);
      }
      const scripts = new Map(), frames = new Map();
      let scriptCount = 0, externalScriptCount = 0, frameCount = 0, opaqueFrameCount = 0;
      for (const script of nodes("script[src]")) {
        scriptCount++;
        const origin = Core.origin(script.getAttribute("src"), document.baseURI);
        if (!origin || origin === source) continue;
        externalScriptCount++;
        const row = scripts.get(origin) || {origin, count: 0, integrityCount: 0};
        row.count++;
        if (script.getAttribute("integrity")) row.integrityCount++;
        scripts.set(origin, row);
        if (sealed && !seenScripts.has(origin)) report({kind: "script", destination: origin, categories: [...categories], added: true});
        // Keep initial origins only until sensitive fields exist, so late forms still trigger a finding.
        if (!sealed || sensitiveFieldCount) seenScripts.add(origin);
      }
      for (const frame of nodes("iframe")) {
        frameCount++;
        const origin = frame.hasAttribute("srcdoc") ? null : Core.origin(frame.getAttribute("src") || "about:blank", document.baseURI);
        if (!origin) { opaqueFrameCount++; continue; }
        const row = frames.get(origin) || {origin, count: 0};
        row.count++;
        frames.set(origin, row);
        if (origin !== source && sealed && !seenFrames.has(origin)) report({kind: "frame", destination: origin, categories: [...categories], added: true});
        if (!sealed || sensitiveFieldCount) seenFrames.add(origin);
      }
      if (formRows.size > 30 || scripts.size > 30 || frames.size > 30) truncated = true;
      const structure = Core.sanitizeStructure({complete: document.readyState !== "loading", truncated,
        formCount: forms.length, sensitiveFormCount: byForm.size, sensitiveFieldCount, categories: [...categories],
        scriptCount, externalScriptCount, frameCount, opaqueFrameCount,
        forms: [...formRows.values()], scripts: [...scripts.values()], frames: [...frames.values()]});
      const next = JSON.stringify(structure);
      if (next !== signature) { signature = next; send({type: "structure", structure}); }
    }
    function schedule() {
      if (!scheduled) { scheduled = true; setTimeout(scan, 150); }
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => !record.target.closest?.("[data-input-defender-notice]"))) schedule();
    });
    observer.observe(document, {childList: true, subtree: true, attributes: true,
      attributeFilter: ["action", "formaction", "method", "formmethod", "form", "type", "autocomplete", "name", "id", "src", "srcdoc", "integrity", "href"]});
    scan();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { scan(); sealed = true; }, {once: true});
    else sealed = true;
    return {configure(next) { settings = Core.sanitizeSettings(next); reported.clear(); schedule(); }};
  }
  Object.defineProperty(globalThis, "InputDefenderStructure", {value: Object.freeze({start})});
})();
