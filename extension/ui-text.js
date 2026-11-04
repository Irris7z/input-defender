/* Display copy only. Detection reasons and their severity remain in core.js. */
(() => {
  "use strict";
  globalThis.InputDefenderUI = Object.freeze({
    reasons: Object.freeze({
      "form-external": "個人情報用フォームに、表示中のページとは別の送信先が指定されています。正規の決済や連携でも起こります。",
      "form-changed": "個人情報用フォームの送信先が、ページの読み込み後に変更されました。",
      "insecure": "個人情報用フォーム、または入力直後の通信に、暗号化されない送信先が使われています。",
      "typing-transfer": "個人情報用の欄への入力から5秒以内に、別の送信先への送信処理が呼び出されました。",
      "network-after-input": "個人情報用の欄への入力から5秒以内に、別の送信先への通信が確認されました。",
      "external-redirect": "入力直後の通信が、別の送信先へ転送されました。"
    }),
    kinds: Object.freeze({form: "フォーム", fetch: "ページ内の送信処理", xhr: "ページ内の送信処理", beacon: "ページからの通知送信", websocket: "継続接続の送信", network: "通信の観測"})
  });
})();
