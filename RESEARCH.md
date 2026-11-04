# 類似製品の調査

調査日: 2026年11月4日。公式製品説明、公式プライバシー説明、現行のChrome Web Store掲載内容を確認。機能が似ていても、入力値を読まないという条件への適合は別に評価しています。

| 製品 | 形態・主用途 | 今回の構想との関係 |
| --- | --- | --- |
| Feroot PageScanner | 無料Chrome拡張。サイトのスクリプト、通信先、フォームを監査 | ブラウザ内で解析し、フォーム入力値を取得せず、テレメトリーなしと説明。今回のプライバシー方針に特に近い。主用途は監査・調査用レポートで、一般利用者向け自動防御と同一とはいえない。 |
| Netcraft Extension | 個人向け無料拡張。悪性サイト・スクリプト・スキマーを検知/ブロック | 機能は非常に近い。公式FAQは、カード番号やパスワードなどの入力と送信リクエストを照合する方式も説明している。入力値を参照しない今回の方式とは異なる。 |
| Malwarebytes Browser Guard | 個人向けChrome等の拡張。悪性サイト、詐欺、トラッカーを防御 | カードスキマー保護を掲げる。ただし公開説明だけで入力値を一切読まないとは確認できない。検知/端末データ等のテレメトリーがあり、無効化は可能。 |
| Jscrambler Webpage Integrity | 企業が自社サイトに導入するサービス | スクリプトの挙動変化、入力欄への不正アクセス、外部転送を監視・制御。利用者が任意のサイトを守るChrome拡張とは導入主体が異なる。 |
| Cloudflare Client-side security（旧Page Shield） | サイト運営者向けサービス | スクリプト、通信先、変更などを監視。改ざん検知に近いが利用者側の拡張ではなく、機能はプランに依存する。 |

## 一次情報

- Feroot: [現行Chrome Web Store](https://chromewebstore.google.com/detail/feroot-pagescanner/onnonipjbalfikdmakiohocdkbnmgpph)、[PageScanner privacy policy](https://www.feroot.com/feroot-pagescanner-privacy-policy/)
- Netcraft: [公式製品ページ・FAQ](https://www.netcraft.com/resources/apps-and-extensions/browser-extension)
- Malwarebytes: [Browser Guard](https://www.malwarebytes.com/browserguard)、[プライバシーポリシー](https://www.malwarebytes.com/privacy/policy-for-browser-guard)
- Jscrambler: [Webpage Integrity](https://jscrambler.com/webpage-integrity)
- Cloudflare: [Client-side security公式ドキュメント](https://developers.cloudflare.com/client-side-security/)

Ferootの旧「Privacy Extension」紹介ページは入力欄へのアクセス警告を説明していますが、インストール先は現在のPageScannerへ転送されます。旧ページの説明をそのまま現行版の機能保証として扱わないこと。調査時のストア表示は6.05 S、2026年11月2日更新でした。

## 開発上の位置づけ

同種製品が存在しない市場ではありません。今回の差別化の軸は、**入力値・通信本文を参照しない、外部判定サービスに接続しない、一般利用者へ不審な挙動の根拠を分かりやすく示す**ことです。

本文の照合をしないため検知精度・断定能力には限界があります。既存のスキマー対策製品と同等の遮断率を主張できません。
