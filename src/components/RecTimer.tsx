import { useEffect, useState } from "react";
import { Text } from "react-native";

/**
 * Таймер записи живёт в своём компоненте намеренно.
 * Раньше секунды тикали состоянием в ChatScreen — каждый тик перерисовывал
 * весь экран, и линия записи на кадр замирала. Здесь перерисовывается
 * только это число.
 */
export default function RecTimer({ color, fontSize = 11.5, fontFamily }: {
  color: string;
  fontSize?: number;
  fontFamily?: string;
}) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSec((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={{ fontFamily, fontSize, color }} allowFontScaling={false}>
      {`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`}
    </Text>
  );
}
