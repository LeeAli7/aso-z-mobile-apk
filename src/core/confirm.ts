/**
 * confirm.ts — одно подтверждение на все разрушительные действия.
 *
 * Раньше часть кнопок удаляла данные сразу в один тап (MCP-сервер, вебхук,
 * карточка канбана, счётчики токенов, автозадача), а часть спрашивала.
 * Теперь правило одно: удаление всегда идёт через этот helper.
 */
import { Alert } from "react-native";

export function confirmDangerous(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = "Удалить",
): void {
  Alert.alert(title, message, [
    { text: "Отмена", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: () => void onConfirm() },
  ]);
}
