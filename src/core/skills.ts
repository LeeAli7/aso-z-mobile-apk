/**
 * skills.ts — навыки агента (как Hermes: SKILL.md + progressive disclosure).
 *
 * Навыки живут в файловой системе терминала: $PREFIX/home/.aso/skills/<name>/SKILL.md
 * (там же, где память). Агент может читать список (skill_view) и управлять
 * навыками (skill_manage). Это процедурная память: «как делать класс задач».
 *
 * Формат SKILL.md (frontmatter — как в Hermes):
 *   ---
 *   name: <нижний регистр, дефисы>
 *   description: <что делает, по чему искать>
 *   ---
 *   <тело навыка: триггеры, шаги, питфоллы>
 */
import { runCommandCapture } from "./runtime";

const SKILLS_DIR = ".aso/skills";

/** Получить директорию навыков (абсолютный путь). */
export async function skillsDir(): Promise<string | null> {
  const r = await runCommandCapture("echo $PREFIX", undefined);
  if (!r.ok) return null;
  const prefix = r.output?.trim();
  if (!prefix) return null;
  return `${prefix}/home/${SKILLS_DIR}`;
}

/** Список навыков: имя + description (как progressive disclosure index). */
export async function listSkills(): Promise<{ name: string; description: string }[]> {
  const dir = await skillsDir();
  if (!dir) return [];
  const r = await runCommandCapture(`ls -1 "${dir}" 2>/dev/null`, undefined);
  if (!r.ok) return [];
  const names = r.output
    ?.split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(".")) ?? [];
  const out: { name: string; description: string }[] = [];
  for (const name of names.slice(0, 50)) {
    const fm = await readFrontmatter(dir, name);
    out.push({ name, description: fm?.description ?? "(нет описания)" });
  }
  return out;
}

async function readFrontmatter(
  dir: string,
  name: string,
): Promise<{ name: string; description: string; body: string } | null> {
  const r = await runCommandCapture(`cat "${dir}/${name}/SKILL.md" 2>/dev/null`, undefined);
  if (!r.ok || !r.output) return null;
  const text = r.output;
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { name, description: "", body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return {
    name: meta.name ?? name,
    description: meta.description ?? "",
    body: m[2].trim(),
  };
}

export interface SkillInfo {
  name: string;
  description: string;
  body: string;
}

/** Полный контент навыка (view). */
export async function viewSkill(name: string): Promise<string> {
  // защита от path traversal
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) {
    return "ошибка: имя навыка должно быть: латиница/цифры/дефисы/подчёркивания, до 64 симв.";
  }
  const dir = await skillsDir();
  if (!dir) return "рантайм недоступен (память/навыки работают только на Android)";
  const r = await runCommandCapture(`cat "${dir}/${name}/SKILL.md" 2>/dev/null`, undefined);
  if (!r.ok || !r.output?.trim()) return `Навык «${name}» не найден. Доступные: ${(await listSkills()).map((s) => s.name).join(", ") || "—"}`;
  return r.output.slice(0, 8000);
}

/** Создать/обновить навык (manage). */
export async function saveSkill(
  name: string,
  description: string,
  body: string,
): Promise<string> {
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) {
    return "ошибка: имя навыка должно быть: латиница/цифры/дефисы/подчёркивания, до 64 симв.";
  }
  if (!description || !body) return "ошибка: нужны description и тело навыка";
  const dir = await skillsDir();
  if (!dir) return "рантайм недоступен (навыки работают только на Android)";
  const content = `---\nname: ${name}\ndescription: ${description.slice(0, 400)}\n---\n\n${body}`;
  // пишем через cat-heredoc: кавычки/переводы строк экранируем base64 (RN: без Buffer)
  const b64 = utf8ToBase64(content);
  const cmds = [
    `mkdir -p "${dir}/${name}"`,
    `echo ${b64} | base64 -d > "${dir}/${name}/SKILL.md"`,
  ].join(" && ");
  const r = await runCommandCapture(cmds, undefined);
  if (!r.ok) return `не удалось записать навык: ${r.error || r.output || `exit ${r.code}`}`;
  return `Навык «${name}» сохранён: ${content.split("\n").length} строк.`;
}

/** Удалить навык. */
export async function deleteSkill(name: string): Promise<string> {
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) return "ошибка: некорректное имя навыка";
  const dir = await skillsDir();
  if (!dir) return "рантайм недоступен";
  const r = await runCommandCapture(`rm -rf "${dir}/${name}"`, undefined);
  return r.ok ? `Навык «${name}» удалён.` : `не удалось удалить: ${r.error || r.output || `exit ${r.code}`}`;
}

/** Быстрый поиск навыка по описанию (progressive disclosure). */
export async function findSkill(query: string): Promise<string | null> {
  const list = await listSkills();
  const q = query.toLowerCase();
  const hit = list.find((s) => s.name.includes(q) || s.description.toLowerCase().includes(q));
  return hit ? hit.name : null;
}

/** UTF-8 → base64 без Buffer (RN-safe). */
function utf8ToBase64(str: string): string {
  try {
    // btoa с Unicode может кинуть на редких символах — предварительно кодируем в UTF-8 байты
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    // fallback: encodeURIComponent-трюк
    const b64 = btoa(
      unescape(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))),
    );
    return b64;
  }
}