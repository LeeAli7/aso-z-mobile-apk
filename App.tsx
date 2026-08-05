/**
 * Aso-z Mobile — точка входа.
 * 3 таба: Чат / Vibe / Настройки + стек VibeProject.
 * LLM-запросы идут напрямую к провайдерам (core/gateway);
 * наш сервер используется только для синхрона аккаунта.
 */
import React from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";

import { AppProvider, useApp } from "./src/store/AppStore";
import { ChatScreen } from "./src/screens/ChatScreen";
import { VibeScreen } from "./src/screens/VibeScreen";
import { VibeProjectScreen } from "./src/screens/VibeProjectScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ToastHost } from "./src/design-system/components/Toast";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ route, focused }: { route: string; focused: boolean }) {
  const { theme } = useApp();
  const icons: Record<string, keyof typeof MaterialIcons.glyphMap> = {
    Chat: "chat-bubble-outline",
    Vibe: "code",
    Settings: "settings",
  };
  return (
    <MaterialIcons
      name={focused && route === "Chat" ? "chat-bubble" : icons[route] ?? "circle"}
      size={22}
      color={focused ? theme.accentHi : theme.mute}
    />
  );
}

function MainTabs() {
  const { theme } = useApp();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.border,
          paddingTop: 4,
          height: 60,
        },
        tabBarActiveTintColor: theme.accentHi,
        tabBarInactiveTintColor: theme.mute,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
        tabBarIcon: ({ focused }) => <TabIcon route={route.name} focused={focused} />,
      })}
    >
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Vibe" component={VibeScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

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
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="VibeProject" component={VibeProjectScreen} />
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
