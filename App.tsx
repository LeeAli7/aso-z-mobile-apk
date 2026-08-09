/**
 * Aso-z 2.0 — навигация по Kimi (4 вкладки: Чат / Поиск / Агент / Мои).
 * Всё в стиле Kimi: тёмный #0D0D0D, капсулы, Geist Mono, без эмодзи.
 */
import React from "react";
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
import { ToastHost } from "./src/design-system/components/Toast";

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