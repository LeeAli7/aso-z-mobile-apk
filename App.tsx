/**
 * Aso-z 2.0 — навигация по Kimi (4 вкладки: Чат / Поиск / Агент / Мои).
 * Всё в стиле Kimi: тёмный #0D0D0D, капсулы, Geist Mono, без эмодзи.
 */
import React, { useEffect } from "react";
import { Platform, PermissionsAndroid } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppProvider, useApp } from "./src/store/AppStore";
import { ChatScreen } from "./src/screens/ChatScreen";
import { VibeProjectScreen } from "./src/screens/VibeProjectScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ProvidersScreen } from "./src/screens/ProvidersScreen";
import { AgentSettingsScreen } from "./src/screens/AgentSettingsScreen";
import { ToastHost, showToast } from "./src/design-system/components/Toast";

/**
 * Проверка доступа к хранилищу при каждом запуске приложения (п.3).
 * Если разрешения нет — показываем системный экран Android:
 *  • Android < 11 — системный диалог «Разрешить доступ к файлам» (PermissionsAndroid).
 *  • Android 11+  — системный экран «Все файлы» (нативно, через AsoRuntime).
 * Android сам не показывает диалог повторно, если пользователь уже отказал —
 * в этом случае юзер включит «Все файлы» вручную в настройках.
 */
let storageCheckRan = false;
async function ensureStoragePermission(): Promise<void> {
  if (Platform.OS !== "android" || storageCheckRan) return;
  storageCheckRan = true;
  try {
    const { hasStorageAccess, openStorageSettings } = await import("./modules/aso-runtime/src");
    const has = await hasStorageAccess().catch(() => false);
    if (has) return;
    if ((Platform.Version as number) < 30) {
      // системный диалог Android
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        showToast("err", "Без доступа к файлам агент не сможет читать хранилище");
      }
    } else {
      // системный экран «Все файлы» (Android 11+)
      await openStorageSettings().catch(() => false);
    }
  } catch {
    // безопасно молчим — разрешения не критичны для обычного чата
  }
}

const Stack = createNativeStackNavigator();

function RootNav() {
  const { theme } = useApp();
  const navTheme = {
    ...(theme.name === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.name === "dark" ? DarkTheme.colors : DefaultTheme.colors),
      background: theme.bg,
      card: theme.surface,
      text: theme.text,
      border: theme.border,
      primary: theme.accent,
    },
  };
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={ChatScreen} />
        <Stack.Screen name="VibeProject" component={VibeProjectScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="AgentSettings" component={AgentSettingsScreen} />
        <Stack.Screen name="Providers" component={ProvidersScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function ThemedApp() {
  const { theme } = useApp();
  // При каждом запуске приложения — проверка доступа к хранилищу (п.3):
  // системный запрос Android, если разрешение ещё не выдано.
  useEffect(() => {
    void ensureStoragePermission();
  }, []);
  return (
    <>
      <StatusBar style={theme.name === "dark" ? "light" : "dark"} />
      <RootNav />
      <ToastHost />
    </>
  );
}

export default function App() {
  // Шрифты Kimi (MiSans/Geist Mono/Pixelify) — вытащены из APK Kimi.
  const [fontsLoaded] = useFonts({
    "MiSansLatin-Regular": require("./assets/fonts/MiSansLatin-Regular.otf"),
    "MiSansLatin-Medium": require("./assets/fonts/MiSansLatin-Medium.otf"),
    "MiSansLatin-Demibold": require("./assets/fonts/MiSansLatin-Demibold.otf"),
    GeistMono: require("./assets/fonts/GeistMono-Regular.ttf"),
    "GeistMono-Italic": require("./assets/fonts/GeistMono-Italic.ttf"),
    PixelifySans: require("./assets/fonts/PixelifySans-Regular.ttf"),
  });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <ThemedApp />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}