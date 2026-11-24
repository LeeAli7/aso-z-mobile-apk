import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated, {
  Easing as REasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { AppIcon } from "../design-system/components/AppIcon";
import { fonts, type Theme } from "../theme/tokens";

type Model = { modelName: string; provider?: string; modelId?: string };

/**
 * Выбор модели — окно раскрывается ВВЕРХ НА МЕСТЕ кнопки.
 *
 * Кнопка не исчезает и не заменяется панелью: та же поверхность растёт из
 * капсулы 118×40 в окно 300×N, радиус 26 → 20. Контент появляется с задержкой
 * 60 мс, чтобы сначала читался рост поверхности, а не текст.
 */
export function ModelPickerPopover({
  open,
  models,
  current,
  onSelect,
  onClose,
  theme,
  top,
  right = 10,
}: {
  open: boolean;
  models: Model[];
  current?: string;
  onSelect: (m: Model) => void;
  onClose: () => void;
  theme: Theme;
  top: number;
  right?: number;
}) {
  const [mounted, setMounted] = useState(open);
  const p = useSharedValue(0);

  const rows = Math.min(models.length, 6);
  const targetH = 52 + rows * 44 + 10;
  const targetW = 300;

  useEffect(() => {
    if (open) {
      setMounted(true);
      p.value = withTiming(1, { duration: 260, easing: REasing.out(REasing.cubic) });
      return;
    }
    p.value = withTiming(0, { duration: 180, easing: REasing.in(REasing.cubic) });
    const id = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(id);
  }, [open, p]);

  const box = useAnimatedStyle(() => ({
    width: 118 + (targetW - 118) * p.value,
    height: 40 + (targetH - 40) * p.value,
    borderRadius: 26 + (20 - 26) * p.value,
  }));

  const body = useAnimatedStyle(() => ({
    opacity: p.value * p.value,
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "box-none" : "none"}>
      {/* тап мимо окна закрывает */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Закрыть выбор модели"
      />
      <Reanimated.View
        style={[
          {
            position: "absolute",
            right,
            top,
            backgroundColor: theme.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            overflow: "hidden",
          },
          box,
        ]}
      >
        <Reanimated.View style={[{ flex: 1 }, body]}>
          <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 16 }}>
            <Text style={{ color: theme.mute, fontSize: 11.5, letterSpacing: 0.8, fontFamily: fonts.sansMedium }}>
              МОДЕЛЬ
            </Text>
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {models.length === 0 ? (
              <Text style={{ color: theme.dim, fontSize: 13, paddingHorizontal: 16, paddingVertical: 12 }}>
                Модели не подключены
              </Text>
            ) : (
              models.map((m) => {
                const on = m.modelName === current;
                return (
                  <Pressable
                    key={(m.provider ?? "") + m.modelName}
                    onPress={() => onSelect(m)}
                    style={({ pressed }) => ({
                      height: 44,
                      paddingHorizontal: 16,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: pressed ? theme.surface2 : "transparent",
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={m.modelName}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        color: on ? theme.text : theme.dim,
                        fontSize: 13.5,
                        fontFamily: on ? fonts.sansDemi : fonts.sansMedium,
                      }}
                    >
                      {m.modelName}
                    </Text>
                    {on ? <AppIcon name="check" size={16} color={theme.text} /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Reanimated.View>
      </Reanimated.View>
    </View>
  );
}
