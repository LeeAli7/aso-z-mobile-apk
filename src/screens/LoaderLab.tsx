import React from "react";
import { View, StyleSheet } from "react-native";
import { PillSwapLoader } from "../components/loaders/PillSwapLoader";
import { PillBurstLoader } from "../components/loaders/PillBurstLoader";

/**
 * Стенд для визуальной сверки лоадеров с HTML-референсом.
 * Только web + ?lab=swap | ?lab=burst
 */
export function LoaderLab({ which }: { which: string }) {
  return (
    <View style={s.root}>
      {which === "burst" ? (
        <PillBurstLoader size={1} />
      ) : (
        <PillSwapLoader size={1} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
});
