import UIKit
import SwiftUI
import SafariServices

final class ViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: SetupView())
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
    }
}

private struct SetupView: View {
    private let accent = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.50, green: 0.78, blue: 0.60, alpha: 1)
            : UIColor(red: 0.16, green: 0.36, blue: 0.25, alpha: 1)
    })
    @State private var settingsHelp = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(spacing: 14) {
                        Image("LargeIcon").resizable().frame(width: 58, height: 58).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Input Defender").font(.title2.bold())
                            Text("入力する前から、サイトの動きを確認").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Label("Safari用の拡張機能", systemImage: "puzzlepiece.extension")
                        .font(.subheadline.weight(.semibold)).foregroundStyle(accent)
                    Text("アプリを入れた後、Safariの設定で拡張機能を有効にしてください。監視するWebサイトへのアクセス許可も必要です。")
                    VStack(alignment: .leading, spacing: 18) {
                        step("1", "拡張機能を有効にする", "設定 → アプリ → Safari → 機能拡張 → Input Defenderで「機能拡張を許可」をオンにします。")
                        step("2", "監視するサイトを許可する", "SafariのページメニューからInput Defenderを開き、監視したいサイトへのアクセスを許可します。許可されていないサイトは監視できません。")
                        step("3", "ページを再読み込みする", "フォームやサイト構造を自動で確認します。検知理由・サイト構造・監視モードは、Safariのページメニュー内のInput Defenderから確認できます。")
                    }
                    Button(action: openSettings) {
                        Label("Safariの拡張機能設定を開く", systemImage: "gearshape")
                            .frame(maxWidth: .infinity).padding(.vertical, 7)
                    }
                    .buttonStyle(.borderedProminent).tint(accent)
                    .accessibilityIdentifier("openSafariSettings")
                    GroupBox("警告の見方") {
                        VStack(alignment: .leading, spacing: 12) {
                            level("WARNING", "HTTP・GET設定・外部送信先など", Color(red: 0.6, green: 0.39, blue: 0))
                            level("CRITICAL", "入力直後の外部送信・新しい外部スクリプトなど", .red)
                            level("FATAL", "フォーム送信先の変更", .purple)
                            Text("深刻度は挙動からの推定です。漏えいや悪意の確定ではありません。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                    GroupBox("プライバシー") {
                        Text("入力値・入力文字・通信本文・Cookieは取得しません。外部の判定サービスやアクセス解析にも接続しません。記録はSafari拡張のメモリ内、設定はこの端末に保存します。アプリ本体には閲覧・入力データを渡しません。")
                            .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                    GroupBox("監視できる範囲") {
                        Text("Safariで許可したHTTP(S)ページが対象です。フォーム・サイト構造と、対応するFetch / XHR / Beacon / WebSocket送信を監視します。Chromeなど他ブラウザやアプリ内ブラウザ、画像・Worker・リダイレクトを含む通信全体は監視しません。警告がなくても安全を保証しません。")
                            .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
                    }
                    Text("初期設定は検知のみ。送信を止めるモードは、Safari内の拡張から変更できます。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(20).frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Safariで使い始める").navigationBarTitleDisplayMode(.inline)
            .alert("Safariの設定を開いてください", isPresented: $settingsHelp) {
                Button("閉じる", role: .cancel) {}
            } message: {
                Text("設定 → アプリ → Safari → 機能拡張 → Input Defenderを開いてください。")
            }
        }
    }
    private func step(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number).font(.headline).foregroundStyle(accent)
                .frame(width: 28, height: 28).background(accent.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
    private func level(_ name: String, _ text: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(name).font(.caption.bold()).foregroundStyle(color)
            Text(text).font(.subheadline)
        }
    }
    private func openSettings() {
        if #available(iOS 26.2, *) {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: ["jp.irris7z.inputdefender.Extension"]) { error in
                if error != nil { settingsHelp = true }
            }
        } else { settingsHelp = true }
    }
}
