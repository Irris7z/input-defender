import Cocoa
import SwiftUI
import SafariServices

final class ViewController: NSViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = NSHostingView(rootView: SafariSetupView())
        host.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.topAnchor.constraint(equalTo: view.topAnchor),
            host.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }
}

private struct SafariSetupView: View {
    private let extensionIdentifier = (Bundle.main.bundleIdentifier ?? "jp.irris7z.inputdefender.mac") + ".Extension"
    private let accent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(red: 0.50, green: 0.78, blue: 0.60, alpha: 1)
            : NSColor(red: 0.16, green: 0.36, blue: 0.25, alpha: 1)
    })
    @State private var status = "有効化状態を確認中"
    @State private var statusNote = "Safariの設定を確認しています。"
    @State private var openingSettings = false
    @State private var settingsError = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Image(nsImage: NSApplication.shared.applicationIconImage)
                    .resizable().frame(width: 64, height: 64).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Input Defender").font(.title.bold())
                    Text("入力する前から、サイトの動きを確認").foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Text("Safari用").font(.caption.weight(.semibold)).padding(8)
                    .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                    .foregroundStyle(accent)
            }.padding(24)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    GroupBox {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(status, systemImage: "puzzlepiece.extension").font(.headline)
                            Text(statusNote).font(.subheadline).foregroundStyle(.secondary)
                            Text("ここで確認するのは拡張の有効化だけです。サイトごとの監視状態は、Safari内のInput Defenderで確認してください。")
                                .font(.caption).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(10)
                    }
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("Safariで使い始める").font(.title3.bold())
                            step("1", "拡張機能を有効にする", "Safari → 設定 → 機能拡張でInput Defenderをオンにします。下のボタンから開けます。")
                            step("2", "監視するサイトを許可する", "SafariのInput DefenderからWebサイトへのアクセスを許可します。許可していないサイトは監視できません。")
                            step("3", "ページを再読み込みする", "フォームと構造を自動で確認します。Safariのツールバー内の拡張から、記録・サイト構造・監視モードを確認できます。")
                            Text("初期設定は検知のみ。対応する送信を止めるモードも、Safari内の拡張から選べます。")
                                .font(.caption).foregroundStyle(.secondary)
                        }.frame(minWidth: 280, maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .leading, spacing: 16) {
                            GroupBox("警告の見方") {
                                VStack(alignment: .leading, spacing: 12) {
                                    level("WARNING", "HTTP・GET設定・外部送信先など", Color(red: 0.6, green: 0.39, blue: 0))
                                    level("CRITICAL", "入力直後の外部送信・新しい外部スクリプトなど", .red)
                                    level("FATAL", "フォーム送信先の変更", .purple)
                                    Text("悪意や漏えいの確定ではありません。")
                                        .font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                            }
                            GroupBox("プライバシー") {
                                Text("入力値・入力文字・通信本文・Cookieは取得しません。外部の判定サービスやアクセス解析にも接続しません。アプリ本体には閲覧・検知記録を渡しません。")
                                    .font(.subheadline).fixedSize(horizontal: false, vertical: true).padding(8)
                            }
                        }.frame(width: 240)
                    }
                    GroupBox("監視できる範囲") {
                        Text("許可したSafariのHTTP(S)ページで、フォーム・サイト構造と対応するFetch / XHR / Beacon / WebSocket送信を監視します。他ブラウザ、画像・Worker・リダイレクトを含む通信全体は監視しません。警告がなくても安全を保証しません。")
                            .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading).padding(8)
                    }
                }.padding(24)
            }
            Divider()
            HStack {
                Button("状態を再確認", action: refreshState).accessibilityIdentifier("refreshExtensionState")
                Spacer()
                Button(action: openSettings) {
                    Label("Safariの機能拡張設定を開く", systemImage: "gearshape")
                }.buttonStyle(.borderedProminent).tint(accent).controlSize(.large)
                    .disabled(openingSettings).accessibilityIdentifier("openSafariSettings")
            }.padding(20)
        }
        .frame(minWidth: 640, minHeight: 580)
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear(perform: refreshState)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refreshState() }
        .alert("Safariの設定を開けませんでした", isPresented: $settingsError) {
            Button("閉じる", role: .cancel) {}
        } message: {
            Text("Safari → 設定 → 機能拡張を開いてください。拡張が表示されない場合は、アプリと拡張の署名・インストールを確認してください。")
        }
    }
    private func step(_ number: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number).font(.headline).foregroundStyle(accent)
                .frame(width: 28, height: 28).background(accent.opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    private func level(_ name: String, _ detail: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(name).font(.caption.bold()).foregroundStyle(color)
            Text(detail).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { state, error in
            if let state, error == nil {
                status = state.isEnabled ? "Safari拡張は有効です" : "Safari拡張は無効です"
                statusNote = state.isEnabled ? "対象サイトへのアクセス許可も確認してください。" : "Safariの機能拡張設定で有効にしてください。"
            } else {
                status = "有効化状態を取得できませんでした"
                statusNote = "Safariの機能拡張設定で、署名・インストールと有効化状態を確認してください。"
            }
        }
    }
    private func openSettings() {
        openingSettings = true
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            DispatchQueue.main.async {
                openingSettings = false
                settingsError = error != nil
            }
        }
    }
}
