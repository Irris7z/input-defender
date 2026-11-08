# Input Defender for Mac / Safari

macOS 15.4以降・Safari 26以降向けのSafari Web ExtensionとMacアプリです。Apple Silicon / Intelのユニバーサルビルドを用意します。ブラウザ内の検知ロジック、表示、メモリ内記録はiOS Safari版と共有し、アプリ本体は有効化状態の確認と設定の案内を行います。

## ビルド

Xcode 27以降・Node.js 22以降が必要です。

```sh
npm ci
npm run build:macos
```

開発用のアドホック署名を付けたアプリは `artifacts/macos-derived/Build/Products/Release/Input Defender.app` に生成されます。この署名はApple Developer IDや公証に代わるものではありません。Safariで通常の拡張として使う場合は、次のXcodeの署名設定を行ってください。

1. `macos/Input Defender/Input Defender.xcodeproj` をXcodeで開きます。
2. **Input Defender** と **Input Defender Extension** の両ターゲットで、Signing & CapabilitiesのTeamと署名用の識別子を設定します。
3. スキーム **Input Defender**、実行先 **My Mac** を選び、ビルドして実行します。
4. アプリ内の「Safariの機能拡張設定を開く」から、Safari → 設定 → 機能拡張へ移動し、Input Defenderを有効にします。
5. SafariのInput Defenderから対象サイトへのアクセスを許可し、ページを再読み込みします。

Macアプリは拡張の有効/無効をAppleの公式APIで確認します。これはサイトごとの監視完了を示すものではありません。サイトのアクセス許可やページの監視状態はSafari内の拡張から確認してください。状態の取得や設定画面を開く処理が失敗した場合は、手動の確認手順を表示します。アプリのBundle Identifierを変更した場合は、拡張の識別子をアプリの識別子＋`.Extension` に揃えてください。

Safariは署名のない拡張を通常は読み込みません。開発時にはSafariの開発者設定から一時的に署名なしの拡張を許可する方法もありますが、本プロジェクトのビルド・テストはその設定を変更しません。Safari本体での有効化とサイト権限の検証、Appleの開発用署名・Developer ID署名・公証・Mac App Store公開は別途必要です。開発用ビルドを一般配布用の完成品として扱わないでください。

## 監視範囲とプライバシー

- 個人情報用フォームのHTTP・GET設定・外部送信先・送信先変更を、入力開始前から確認します。
- 新しい外部スクリプト参照元、外部埋め込み先とサイト構造の一覧を表示します。
- 個人情報用の欄への入力直後のFetch / XHR / Beacon / WebSocket送信を、ページ内フックが動作した範囲で検知します。対応する送信の停止は任意です。
- WARNINGは黄、CRITICALは赤、FATALは紫。通知はFATAL → CRITICAL → WARNINGの順に積み重ねます。警告は悪意や漏えいの断定ではありません。
- iOS版と同じManifest V3・非永続バックグラウンドを使います。Safari版では `webRequest` を使わず、画像・Worker・リダイレクトを含むブラウザ全体の通信観測は対象外です。Chromeなど他ブラウザも監視しません。
- 入力値・入力文字・通信本文・Cookie・ヘッダーは読みません。外部サーバー、テレメトリー、証明書による復号、VPNは使いません。
- 記録はSafari拡張の `storage.session` にだけ保存します。再読み込み・タブ終了・ブラウザセッション終了で消去し、永続保存へ切り替えるフォールバックはありません。設定と通知除外は端末内の `storage.local` に保存します。
- アプリ本体は閲覧・検知記録を受け取りません。ネイティブメッセージの権限は要求せず、ハンドラーは内容を読むことなく拒否します。アプリと拡張には追跡・収集なしのPrivacy Manifestを同梱します。
- Release構成のアプリ本体には外部通信の権限を付けません。Debug構成だけはWebKitの端末内テストのためネットワーククライアント権限を持ちます。Safariからのサイト通信は、サイト自身とSafariが行います。

## テスト

```sh
npm test
npm run test:macos
npm run test:ios
```

`test:macos` は端末内の4173 / 4174番ポートで検証サーバーを起動し、終了時に停止します。同じポートのデモサーバーは先に終了してください。

ネイティブの検知テストは `tests/apple/SafariEngineTests.swift` をiOSと共有します。macOSのWebKitで、空欄GETフォーム・フォーム送信先変更・新しい外部参照・停止モードのフォーム送信を確認し、正式な拡張バンドルAPIでmanifestを解析します。拡張メッセージAPIはモックであり、Safari本体の権限UIと休止復帰のテストとは別です。Macの案内画面も描画してテスト添付画像を保存します。

GitHub ActionsではXcode 27ランナーでMacのユニバーサルビルド・macOS WebKitテスト・iOSビルド・iOS WebKitテストを行い、成功後に従来のChrome検証とリリース処理へ進みます。リリースの拡張用ZIPはChrome用です。Safari版はリポジトリのXcodeプロジェクトからビルドしてください。

## 公式資料

- [Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Safari向けの最適化とバックグラウンドの制約](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)
- [Safari拡張の実行・署名なしの場合の扱い](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- [Safari拡張の配布・Developer IDと公証](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
