/**
 * codeDump.ts — «модель напечатала файл в чат».
 *
 * Часть моделей (особенно бесплатные и Google через OpenAI-слой) вместо вызова
 * write_file вываливает содержимое файла в ответ текстом. Пользователю это
 * бесполезно: файла нет, а в чате простыня. Определяем такой ответ, чтобы
 * один раз попросить модель всё-таки создать файл.
 *
 * Не срабатываем на короткие примеры кода (объяснение в 3 строки) — только на
 * реальные «файлы»: длинный блок кода или целая HTML-страница.
 */

const FENCE = /```[a-zA-Z0-9+#._-]*\n([\s\S]*?)```/g;

export function looksLikeCodeDump(text: string): boolean {
  const s = String(text ?? "");
  if (!s.trim()) return false;
  // целая страница
  if (/<!doctype html/i.test(s) && /<\/html>/i.test(s)) return true;
  if (/<html[\s>]/i.test(s) && /<\/html>/i.test(s)) return true;
  // длинный блок кода в ответе
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(s)) !== null) {
    const body = m[1] ?? "";
    const lines = body.split("\n").filter((l) => l.trim() !== "").length;
    if (lines >= 12) return true;
  }
  // код без ограждения: много строк, похожих на код
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  if (lines.length >= 20) {
    const codeish = lines.filter((l) =>
      /^\s{2,}\S/.test(l) || /[;{}]\s*$/.test(l) || /^\s*(const|let|var|function|class|import|export|def|if|for|while|return)\b/.test(l),
    ).length;
    if (codeish / lines.length >= 0.6) return true;
  }
  return false;
}
