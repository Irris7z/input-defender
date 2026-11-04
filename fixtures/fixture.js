"use strict";
const destination = "http://127.0.0.1:4174/collect";
const result = document.getElementById("result");
function test(id, action) {
  document.getElementById(id).addEventListener("click", async () => {
    try { await action(); result.textContent = "実行しました。拡張の警告・記録を確認してください。"; }
    catch (error) { result.textContent = `${error.name}: ${error.message}`; }
  });
}
test("fetch-test", () => fetch(destination, {method: "POST", body: "fixture"}));
test("xhr-test", () => { const xhr = new XMLHttpRequest(); xhr.open("POST", destination); xhr.send("fixture"); });
test("beacon-test", () => { if (!navigator.sendBeacon(destination, "fixture")) throw new Error("Beaconは送信されませんでした"); });
test("image-test", () => { const image = new Image(); image.src = `${destination}?kind=fixture`; });
test("change-test", () => { document.getElementById("checkout").action = destination; });
test("redirect-test", () => fetch("/redirect"));
