"use strict";
const {readFileSync, writeFileSync, mkdirSync} = require("node:fs");
const {join} = require("node:path");
const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "extension/manifest.json"), "utf8"));
delete manifest.minimum_chrome_version;
// iOS cannot use webRequest in a nonpersistent background. Keep shared DOM/API rules.
manifest.permissions = ["storage"];
manifest.browser_specific_settings = {safari: {strict_min_version: "26.0"}};
const directory = join(root, "ios/Safari");
mkdirSync(directory, {recursive: true});
writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
