/**
 * Sheet — BottomSheet на @gorhom/bottom-sheet.
 * Свайп вниз, backdrop, snapPoints, скруглённые углы.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import BottomSheetBase, { BottomSheetBackdrop, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useApp } from "../../store/AppStore";
import { IconButton } from "./IconButton";
import { radii } from "../tokens";

export function Sheet({
  visible,
  onClose,
  title,
  children,
  snapPoints = ["50%"],
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  snapPoints?: string[];
}) {
  const { theme } = useApp();
  const ref = useRef<BottomSheetBase>(null);
  const points = useMemo(() => snapPoints, [snapPoints]);

  useEffect(() => {
    if (visible) {
      ref.current?.snapToIndex(0);
    } else {
      ref.current?.close();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="close" />
    ),
    [],
  );

  if (!visible) return null;

  return (
    <BottomSheetBase
      ref={ref}
      index={0}
      snapPoints={points}
      onClose={onClose}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.surface, borderRadius: radii.xl }}
      handleIndicatorStyle={{ backgroundColor: theme.surface2, width: 36, height: 4 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
        <IconButton name="close" onPress={onClose} size={18} haptic={false} accessibilityLabel="Закрыть" />
      </View>
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 32 }}>
        {children}
      </BottomSheetScrollView>
    </BottomSheetBase>
  );
}

export { StyleSheet };
