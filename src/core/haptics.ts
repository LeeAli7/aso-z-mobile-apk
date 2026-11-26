/**
 * haptics.ts — один тип отклика на всё приложение.
 *
 * Раньше в разных местах стояли impactAsync(Light/Medium) и selectionAsync:
 * Medium бьёт долго и навязчиво, Light на Android почти не чувствуется.
 * Здесь на Android используются системные короткие эффекты
 * (Clock_Tick / Keyboard_Tap / Context_Click) — они резкие, чёткие и
 * укладываются в один тик, без «дребезга». На iOS — selection/light.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const A = Haptics.AndroidHaptics;

function run(fn: () => Promise<void>) {
  fn().catch(() => {});
}

/** Любое нажатие: самый короткий и чёткий тик. */
export function tap() {
  if (Platform.OS === "android") run(() => Haptics.performAndroidHapticsAsync(A.Keyboard_Tap));
  else run(() => Haptics.selectionAsync());
}

/** Действие с последствием (отправка, остановка, переключение): чуть плотнее. */
export function commit() {
  if (Platform.OS === "android") run(() => Haptics.performAndroidHapticsAsync(A.Context_Click));
  else run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Ошибка: один сухой отказ, без вибрации-«дрели». */
export function fail() {
  if (Platform.OS === "android") run(() => Haptics.performAndroidHapticsAsync(A.Reject));
  else run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
