/* Display copy only. Detection reasons and their severity remain in core.js. */
(() => {
  "use strict";
  globalThis.InputDefenderUI = Object.freeze({
    levels: Object.freeze({WARNING: "WARNING · 注意", CRITICAL: "CRITICAL · 重大", FATAL: "FATAL · 最優先"}),
    colors: Object.freeze({WARNING: "#986300", CRITICAL: "#b63232", FATAL: "#7634a0"}),
    labels: Object.freeze({
      "form-changed": "フォーム送信先の変更",
      "typing-transfer": "入力直後の外部送信（自動送信の疑い）",
      "external-redirect": "外部への転送",
      "network-after-input": "入力直後の外部通信",
      "form-external": "フォームの外部送信先",
      "insecure": "暗号化されない通信（HTTP）",
      "form-query": "入力内容がURLに含まれるフォーム",
      "script-origin-added": "新しい外部スクリプトの追加",
      "frame-origin-added": "新しい外部埋め込み先の追加"
    }),
    reasons: Object.freeze({
      "form-external": "個人情報用フォームに、表示中のページとは別の送信先が指定されています。正規の決済や連携でも起こります。",
      "form-changed": "個人情報用フォームの送信先が、ページの読み込み後に変更されました。",
      "insecure": "個人情報用フォーム、または入力直後の通信に、暗号化されない送信先が使われています。",
      "typing-transfer": "個人情報用の欄への入力から5秒以内に、別の送信先への送信処理が呼び出されました。",
      "network-after-input": "個人情報用の欄への入力から5秒以内に、別の送信先への通信が確認されました。",
      "external-redirect": "入力直後の通信が、別の送信先へ転送されました。",
      "form-query": "個人情報用フォームがGET送信に設定されています。送信すると入力内容がURLに含まれる構造です。入力値は確認していません。",
      "script-origin-added": "個人情報用の欄があるページで、初期読み込み後に新しい外部スクリプトの参照元が追加されました。正規の広告や決済処理でも起こります。",
      "frame-origin-added": "個人情報用の欄があるページで、初期読み込み後に新しい外部埋め込み先が追加されました。正規の決済や認証でも起こります。"
    }),
    kinds: Object.freeze({form: "フォーム", fetch: "ページ内の送信処理", xhr: "ページ内の送信処理", beacon: "ページからの通知送信", websocket: "継続接続の送信", network: "通信の観測", script: "スクリプトの構造変化", frame: "埋め込みの構造変化"})
  });
})();
