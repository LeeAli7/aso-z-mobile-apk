/**
 * Config plugin для AsoRuntime (встроенный Termux bootstrap).
 *
 * Что делает:
 *  1. Регистрирует авто-линковку локального нативного модуля (modules/aso-runtime).
 *  2. Копирует bootstrap-архивы в android assets (app/src/main/assets/bootstrap/).
 *  3. Добавляет FOREGROUND_SERVICE + POST_NOTIFICATIONS permissions (для
 *     foreground service «Агент активен», чтобы shell-процесс не убивали в фоне).
 *
 * Usage: app.json → plugins: ["./modules/aso-runtime/app.plugin.js"]
 */
const fs = require("fs");
const path = require("path");

const { withDangerousMod, withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

const FOREGROUND_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.POST_NOTIFICATIONS",
  // Доступ «Все файлы» (Android 11+): агент может читать/писать хранилище
  // за пределами песочницы приложения (папки рядом с Aso-z и т.п.).
  "android.permission.MANAGE_EXTERNAL_STORAGE",
];

module.exports = function asoRuntimePlugin(config) {
  // 1) копируем bootstrap-архивы в assets
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, "assets", "bootstrap");
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
        "bootstrap",
      );
      if (!fs.existsSync(srcDir)) return cfg;
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        if (!file.endsWith(".zip")) continue;
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        if (!fs.existsSync(dest) || fs.statSync(src).size !== fs.statSync(dest).size) {
          fs.copyFileSync(src, dest);
        }
      }
      return cfg;
    },
  ]);

  // 2) permissions для foreground service
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const uses = manifest["uses-permission"] || [];
    for (const perm of FOREGROUND_PERMISSIONS) {
      if (!uses.some((u) => u.$ && u.$["android:name"] === perm)) {
        uses.push({ $: { "android:name": perm } });
      }
    }
    manifest["uses-permission"] = uses;

    // сервис «Агент активен»
    // application в modResults — массив (config-plugins формат), берём первый.
    const apps = Array.isArray(manifest.application) ? manifest.application : [manifest.application || {}];
    const app = apps[0] || {};
    if (!Array.isArray(manifest.application)) manifest.application = apps;
    const services = app.service || [];
    if (!services.some((s) => s.$ && s.$["android:name"] === "expo.modules.aso.AsoRuntimeService")) {
      services.push({
        $: {
          "android:name": "expo.modules.aso.AsoRuntimeService",
          "android:exported": "false",
          "android:foregroundServiceType": "dataSync",
        },
      });
    }
    app.service = services;
    return cfg;
  });

  return config;
};