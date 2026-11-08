# Input Defender for iOS / Safari

iOS 26以降のSafariでフォームとサイト構造を監視するアプリです。iPhone / iPad対応。アプリ本体は有効化手順とプライバシー説明を表示し、検知・記録・設定はSafari Web Extension内で動作します。他ブラウザやアプリ内ブラウザは対象外です。

## ビルドと実機への導入

開発環境はXcode 27以降とNode.js 22以降です。XcodeプロジェクトはApple公式のSafari Web Extension Converterから作成し、拡張のJS/CSS/HTMLはリポジトリ直下の `extension/` を直接参照しています。Safari用manifestだけを `ios/Safari/manifest.json` に生成します。共通ファイルを編集した後は `npm run build` を実行してください。

1. リポジトリ直下で `npm ci`、`npm run build` を実行します。
2. `ios/Input Defender/Input Defender.xcodeproj` をXcodeで開きます。
3. スキームに **Input Defender**、実行先にiPhoneまたはiPadを選びます。
4. 実機ではアプリと **Input Defender Extension** の両ターゲットで、Signing & CapabilitiesのTeamを自分のApple Developerアカウントに設定します。Bundle Identifierを変更する場合は、アプリの `ViewController.swift` にある設定画面用の拡張IDも一致させてください。
5. Xcodeからビルドして実行します。
6. 設定 → アプリ → Safari → 機能拡張 → Input Defenderを有効にし、監視対象サイトへのアクセスを許可します。
7. Safariで対象ページを再読み込みします。ページメニューのInput Defenderから記録・サイト構造・モードを確認できます。

iOS 26.2以降は、アプリの「Safariの拡張機能設定を開く」から公式APIで設定画面へ移動できます。26.0 / 26.1では手動の設定手順を表示します。設定への遷移が失敗しても、同じ手順を表示します。有効化状態をアプリが自動判定する表示はありません。

署名なしのビルドはシミュレーターでのみ利用できます。ビルド済みフォルダーやChrome用ZIPをiPhoneに入れるだけではインストールできません。実機配布・TestFlight・App StoreにはAppleの署名とそれぞれの配布手続きが必要です。署名用の証明書・プロビジョニングプロファイル・Appleアカウント情報はGitに含めません。

## Safari版の検知範囲

| 機能 | iOS Safari |
| --- | --- |
| HTTP・外部送信先・GET設定のフォームを入力前に警告 | 対応 |
| 最初に観測したオリジンからのフォーム送信先変更 | 対応 / FATAL・紫 |
| 新しい外部スクリプト参照元・埋め込み先の追加 | 対応 / CRITICAL・赤、WARNING・黄 |
| 入力直後のFetch / XHR / Beacon / WebSocket送信 | ページのフックが動作した範囲で対応 |
| 対応するフォーム・API送信の停止 | 任意の停止モードで対応 |
| `webRequest` による画像・Worker・リダイレクト等の観測 | 非対応。iOSの非永続バックグラウンドでは利用しない |
| Chrome・他ブラウザ・アプリ内ブラウザの監視 | 非対応 |

送信API監視の設定受領をページ側から確認するハンドシェイクを追加しています。起動が確認できない場合はポップアップにその旨を表示します。このハンドシェイク自体もページ側から偽装される可能性があり、安全性の証明には使いません。Safariで拡張が遅れて起動した場合など、すでに実行済みの処理へ遡って警告・停止できません。

入力値・入力文字・通信本文・Cookie・通信ヘッダーは取得しません。外部サーバー、VPN、証明書による復号、アクセス解析は使いません。記録は `storage.session` にだけ保存し、再読み込み・タブ終了・ブラウザセッション終了で消去します。設定と通知除外だけを `storage.local` に保存します。`storage.session` が使えない環境で永続ストレージへ検知記録を退避する実装はありません。

アプリ本体は閲覧記録を受け取りません。`nativeMessaging` 権限は要求せず、ネイティブ側ハンドラーはリクエストの中身を読まずに拒否します。Appleテンプレートに含まれていたメッセージのログ出力・echo処理は削除しています。アプリと拡張には収集・追跡なしのPrivacy Manifestを同梱しています。

## 検証

```sh
npm test
npm run build:ios
npm run test:ios
```

ネイティブ検知テストのソースは `tests/apple/SafariEngineTests.swift` としてMac版と共有しています。ビルド用の共通スクリプトは `scripts/apple.cjs` です。

`test:ios` はiOS 26以降のインストール済みiPhone Simulatorを選び、端末内の検証サーバーを起動して終了時に停止します。4173 / 4174番ポートを使う他のデモサーバーは、先に終了してください。端末を指定する場合は `IOS_SIMULATOR_UDID=<UDID> npm run test:ios` を使います。実機向けの署名なしコンパイル確認は `npm run build:ios -- --device` です。

自動検証は次を分けて行います。

- Node: 共有ルール・プライバシー制約、Safariで利用できないAPIがなくてもバックグラウンドが起動すること、セッションへの固定スキーマの保存、ネイティブでメッセージを記録しないこと。
- iOS WebKit: 別々のContent Worldへ実際のバンドルを注入し、空欄のGETフォーム・送信先の変更・新しい外部参照・フォーム送信停止を検証。拡張メッセージAPIはテスト用モックです。Safari用manifestもWebKitの正式なアプリ拡張バンドルAPIで解析します。
- Chrome: 従来の実ブラウザテストで回帰を確認。

この自動検証はSafari本体の権限画面・バックグラウンド休止復帰・実機での継続利用の検証とは別です。公開前には、Safariでサイト許可の拒否/許可、再読み込み、モード変更、タブ終了、バックグラウンド復帰、プライベートブラウズ、iPad、文字サイズ拡大、VoiceOverを確認してください。この環境ではSafari本体で拡張を有効化する画面操作は未検証です。

## 公式資料

- [Safari Web Extensionsの作成](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
- [Safari向けの最適化・iOSのバックグラウンド制約](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)
- [Safari拡張の互換性](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)
