"use strict";
// No form contents are read or sent by this fixture's script.
document.getElementById("add-script").addEventListener("click", () => {
  const script = document.createElement("script");
  script.src = "http://127.0.0.1:4174/structure-probe.js";
  document.head.append(script);
});
document.getElementById("add-frame").addEventListener("click", () => {
  const frame = document.createElement("iframe");
  frame.src = "http://127.0.0.1:4174/structure-frame";
  frame.title = "端末内の検証用埋め込み";
  document.body.append(frame);
});
