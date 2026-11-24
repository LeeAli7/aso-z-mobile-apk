/**
 * Конфиг Expo. Обычная сборка — как в app.json, dev-client — отдельный
 * вариант (APP_VARIANT=dev): своё имя и свой пакет, чтобы стоять на телефоне
 * РЯДОМ с боевым Aso-z и не затирать его данные.
 */
const base = require("./app.json").expo;

const variant = process.env.APP_VARIANT ?? "production";
const dev = variant === "dev";

module.exports = {
  ...base,
  name: dev ? "Aso dev" : base.name,
  scheme: dev ? "asozdev" : (base.scheme ?? "asoz"),
  ios: {
    ...(base.ios ?? {}),
    bundleIdentifier: dev ? "app.aso.zmobile.dev" : (base.ios?.bundleIdentifier ?? "app.aso.zmobile"),
  },
  android: {
    ...(base.android ?? {}),
    package: dev ? "app.aso.zmobile.dev" : base.android.package,
    versionCode: base.android?.versionCode ?? 1,
  },
  extra: {
    ...(base.extra ?? {}),
    variant,
  },
};
