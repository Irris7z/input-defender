"use strict";
const {spawn, spawnSync} = require("node:child_process");
const {mkdirSync} = require("node:fs");
const {resolve, join} = require("node:path");
const root = resolve(__dirname, "..");
process.chdir(root);
require("./build.cjs");
mkdirSync(join(root, "artifacts"), {recursive: true});
const testing = process.argv.includes("--test");
const device = process.argv.includes("--device");
const macos = process.argv.includes("--macos");
const platform = macos ? "macos" : "ios";
const project = `${platform}/Input Defender/Input Defender.xcodeproj`;
const args = ["-project", project, "-scheme", "Input Defender", "-configuration", macos && !testing ? "Release" : "Debug", "-derivedDataPath", `artifacts/${platform}-derived`,
  ...(macos ? ["CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM="] : ["CODE_SIGNING_ALLOWED=NO"])];
let fixture;
async function main() {
  let destination = "platform=macOS";
  if (testing && !macos) {
    const inventory = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {encoding: "utf8"});
    if (inventory.status !== 0) throw new Error(inventory.stderr || "iOS Simulatorを確認できませんでした。");
    const devices = JSON.parse(inventory.stdout).devices;
    const candidates = Object.entries(devices).filter(([runtime]) => /iOS-(2[6-9]|[3-9]\d)(-|$)/.test(runtime)).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true})).flatMap(([, entries]) => entries).filter(d => d.name.startsWith("iPhone") && d.isAvailable);
    const id = process.env.IOS_SIMULATOR_UDID || candidates[0]?.udid;
    if (!id) throw new Error("iOS 26以降のiPhone SimulatorをXcodeからインストールしてください。");
    destination = `platform=iOS Simulator,id=${id}`;
  }
  if (testing) {
    fixture = spawn(process.execPath, ["fixtures/server.cjs"], {stdio: ["ignore", "pipe", "pipe"]});
    let fixtureError = "";
    fixture.stderr.on("data", chunk => { fixtureError += chunk; });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (fixture.exitCode !== null || fixtureError) throw new Error(fixtureError || "検証サーバーを起動できませんでした。4173/4174番ポートを確認してください。");
      try {
        const response = await fetch("http://127.0.0.1:4173/structure-lab.html");
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("検証サーバーの起動がタイムアウトしました。");
    args.push("-destination", destination, "test");
  } else if (macos) {
    args.push("-destination", "generic/platform=macOS", "ARCHS=arm64 x86_64", "ONLY_ACTIVE_ARCH=NO", "build");
  } else {
    args.push("-sdk", device ? "iphoneos" : "iphonesimulator", "-destination", `generic/platform=${device ? "iOS" : "iOS Simulator"}`, "build");
  }
  const result = await new Promise((resolve, reject) => {
    const build = spawn("xcodebuild", args, {stdio: "inherit"});
    build.on("error", reject);
    build.on("exit", code => resolve(code ?? 1));
  });
  process.exitCode = result;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fixture?.kill("SIGTERM"));
