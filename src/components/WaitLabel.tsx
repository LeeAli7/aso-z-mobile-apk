import React, { useCallback, useEffect, useState } from "react";
import { StyleProp, TextStyle } from "react-native";
import Reanimated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

/**
 * Надпись рядом с индикатором ожидания. Переливается (как лепестки диафрагмы)
 * и меняется на новую фразу — чтобы не было «просто загрузка стоит».
 */

const PHRASES = [
  "Думаю",
  "Сверяю цифры",
  "Перечитываю задание",
  "Ищу закономерность",
  "Собираю ответ",
  "Проверяю условия",
  "Считаю",
  "Разбираю по частям",
  "Уточняю детали",
  "Смотрю в справочник",
  "Сопоставляю варианты",
  "Проверяю логику",
  "Выписываю главное",
  "Проверяю единицы",
  "Считаю ещё раз",
  "Ищу ошибку",
  "Свожу концы",
  "Проверяю вывод",
  "Подбираю формулировку",
  "Упрощаю",
  "Раскладываю на шаги",
  "Проверяю границы",
  "Сверяю с условием",
  "Размечаю план",
  "Ищу короткий путь",
  "Проверяю знаки",
  "Считаю в уме",
  "Проверяю на примере",
  "Собираю факты",
  "Отделяю главное",
  "Проверяю определение",
  "Прикидываю порядок",
  "Ловлю неточность",
  "Сверяю формулы",
  "Проверяю размерность",
  "Ищу контрпример",
  "Проверяю крайние случаи",
  "Обдумываю ответ",
  "Проверяю по шагам",
  "Выравниваю ряды",
  "Считаю долю",
  "Проверяю проценты",
  "Округляю",
  "Сверяю таблицу",
  "Ищу связь",
  "Проверяю последовательность",
  "Уточняю формулировку",
  "Собираю цепочку",
  "Проверяю причину",
  "Смотрю следствия",
  "Выделяю суть",
  "Проверяю по пунктам",
  "Подбираю пример",
  "Проверяю на пальцах",
  "Считаю разницу",
  "Сверяю даты",
  "Проверяю порядок",
  "Ищу точное слово",
  "Проверяю смысл",
  "Свожу к простому",
  "Проверяю край",
  "Пересчитываю",
  "Проверяю счёт",
  "Сверяю ответ",
  "Вычитываю",
  "Проверяю опечатки",
  "Делаю вывод",
  "Проверяю вывод",
  "Собираю контекст",
  "Проверяю контекст",
  "Ищу источник",
  "Сверяю с источником",
  "Проверяю цитату",
  "Уточняю цифру",
  "Считаю итог",
  "Проверяю итог",
  "Подвожу черту",
  "Выстраиваю ответ",
  "Проверяю структуру",
  "Делаю пометки",
  "Проверяю пометки",
  "Сверяю план",
  "Иду по плану",
  "Проверяю каждый шаг",
  "Считаю внимательно",
  "Проверяю дважды",
  "Ищу лучший вариант",
  "Сравниваю",
  "Проверяю сравнение",
  "Взвешиваю",
  "Проверяю вес",
  "Смотрю пропорции",
  "Проверяю масштаб",
  "Считаю по формуле",
  "Проверяю формулу",
  "Подставляю",
  "Проверяю подстановку",
  "Решаю",
  "Проверяю решение",
  "Ищу изящный ход",
  "Проверяю ход",
  "Разматываю клубок",
  "Проверяю нить",
  "Собираю пазл",
  "Проверяю деталь",
  "Смотрю шире",
  "Проверяю ракурс",
  "Уточняю масштаб",
  "Считаю по частям",
  "Проверяю части",
  "Свожу воедино",
  "Проверяю целое",
  "Делаю аккуратно",
  "Проверяю аккуратность",
  "Ищу короткий ответ",
  "Проверяю краткость",
  "Говорю по делу",
  "Проверяю тон",
  "Подбираю слова",
  "Проверяю слова",
  "Считаю до конца",
  "Проверяю конец",
  "Почти готово",
  "Сверяю последнее",
  "Проверяю финал",
  "Всё проверяю",
  "Держу нить",
  "Не теряю мысль",
  "Иду дальше",
  "Считаю ещё",
];

const BASE = "#EDEDEF";
const WAVE = "#FFFFFF";
const CYCLE = 2400;

function WaveChar({ ch, idx, total, glow, fade }: { ch: string; idx: number; total: number; glow: any; fade: any }) {
  const st = useAnimatedStyle(() => {
    // волна: каждый символ сдвинут по фазе
    const phase = (glow.value + idx / Math.max(1, total)) % 1;
    const intensity = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
    return {
      opacity: fade.value,
      color: interpolateColor(intensity, [0, 1], [BASE, WAVE]),
    };
  });
  return <Reanimated.Text style={st}>{ch}</Reanimated.Text>;
}

export function WaitLabel({
  style,
  active = true,
}: {
  style?: StyleProp<TextStyle>;
  active?: boolean;
}) {
  const [i, setI] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const glow = useSharedValue(0);
  const fade = useSharedValue(1);

  const next = useCallback(() => {
    setI((v) => (v + 1 + Math.floor(Math.random() * 3)) % PHRASES.length);
  }, []);

  useEffect(() => {
    if (!active) return;
    glow.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    const t = setInterval(() => {
      fade.value = withTiming(0, { duration: 170 }, (fin) => {
        if (fin) runOnJS(next)();
      });
    }, CYCLE);
    return () => {
      clearInterval(t);
      glow.value = 0;
    };
  }, [active, glow, fade, next]);

  useEffect(() => {
    if (active) fade.value = withTiming(1, { duration: 260 });
  }, [i, active, fade]);

  const chars = PHRASES[i].split("");

  return (
    <Reanimated.Text
      numberOfLines={1}
      accessibilityLabel="Агент работает"
      style={[{ fontSize: 13, letterSpacing: 0.1, color: BASE }, style]}
    >
      {chars.map((ch, idx) => (
        <WaveChar key={idx} ch={ch} idx={idx} total={chars.length} glow={glow} fade={fade} />
      ))}
    </Reanimated.Text>
  );
}
