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

const { withDangerousMod, withAndroidManifest, withMainActivity, AndroidConfig } = require("@expo/config-plugins");

const FOREGROUND_PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  // ОБЯЗАТЕЛЬНО для Android 14+ (targetSdk 34+): startForeground с типом
  // dataSync без этого permission кидает SecurityException на main-треде →
  // падает весь процесс приложения на КАЖДОЙ команде агента.
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.POST_NOTIFICATIONS",
  // Доступ «Все файлы» (Android 11+): агент может читать/писать хранилище
  // за пределами песочницы приложения (папки рядом с Aso-z и т.п.).
  "android.permission.MANAGE_EXTERNAL_STORAGE",
];

module.exports = function asoRuntimePlugin(config) {
  // 1) копируем bootstrap-архивы (Termux bootstrap) в assets
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const srcBootstrap = path.join(cfg.modRequest.projectRoot, "assets", "bootstrap");
      const srcRootfs = path.join(cfg.modRequest.projectRoot, "assets", "rootfs");
      const srcProot = path.join(cfg.modRequest.projectRoot, "assets", "proot");
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
      );
      const copyDir = (srcDir, sub) => {
        if (!fs.existsSync(srcDir)) return;
        const dest = path.join(destDir, sub);
        fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          if (!file.endsWith(".zip") && !sub.startsWith("rootfs") && !sub.startsWith("proot")) continue;
          const src = path.join(srcDir, file);
          const d = path.join(dest, file);
          if (!fs.existsSync(d) || fs.statSync(src).size !== fs.statSync(d).size) {
            fs.copyFileSync(src, d);
          }
        }
      };
      copyDir(srcBootstrap, "bootstrap");
      copyDir(srcRootfs, "rootfs");
      copyDir(srcProot, "proot");
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

  // 3) edge-to-edge: убирает чёрную системную полосу внизу (навбар) и сверху —
  // контент рисуется под системные панели, навбар становится прозрачным.
  // Капсула ввода больше не «висит на чёрной полоске».
  config = withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("enableEdgeToEdge")) {
      src = src.replace(
        "import expo.modules.ReactActivityDelegateWrapper",
        "import expo.modules.ReactActivityDelegateWrapper\nimport androidx.activity.enableEdgeToEdge",
      );
      src = src.replace(
        "setTheme(R.style.AppTheme);",
        "setTheme(R.style.AppTheme);\n    enableEdgeToEdge();",
      );
      cfg.modResults.contents = src;
    }
    return cfg;
  });

  return config;
};