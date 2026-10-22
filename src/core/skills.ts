/**
 * skills.ts — навыки агента (как Hermes: SKILL.md + progressive disclosure).
 *
 * Навыки живут в файловой системе терминала. Раньше путь жёстко собирался из
 * `$PREFIX` (Termux): в proot-Alpine `$PREFIX` пустой → `skillsDir()` возвращал
 * null → `skill_manage(save)` ВСЕГДА падал с «рантайм недоступен», хотя
 * `skill_view` (список) отвечал «навыков нет». Это и был баг из отчёта.
 *
 * Теперь каталог ищется по цепочке кандидатов ($ASO_SKILLS_DIR → $PREFIX/home/
 * .aso/skills → $HOME/.aso/skills → $HOME/.skills → /data/data/<pkg>/files/home/
 * .aso/skills), создаётся `mkdir -p` и проверяется на запись. Если не нашлось ни
 * одного пригодного — возвращается ошибка С ПРИЧИНОЙ (пути, stderr), а не
 * «рантайм недоступен».
 *
 * Формат SKILL.md (frontmatter — как в Hermes):
 *   ---
 *   name: <нижний регистр, дефисы>
 *   description: <что делает, по чему искать>
 *   ---
 *   <тело навыка: триггеры, шаги, питфоллы>
 */
import { runCommandCapture } from "./runtime";

const PKG = "app.aso.zmobile";

let cachedDir: string | null = null;
let cachedErr: string | null = null;

/** shell-экранирование одинарными кавычками */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Абсолютный путь каталога навыков.
 * Возвращает { dir } при успехе либо { error } с конкретной причиной.
 */
export async function resolveSkillsDir(): Promise<{ dir: string | null; error?: string }> {
  if (cachedDir) return { dir: cachedDir };
  if (cachedErr) return { dir: null, error: cachedErr };

  const probe = await runCommandCapture(
    `printf '%s\\n' "\${ASO_HOME:-}" "\${PREFIX:-}" "\${HOME:-}" "/data/data/${PKG}/files/home" "/root"`,
    undefined,
  );
  if (!probe.ok) {
    cachedErr = `терминал недоступен: ${probe.error || probe.output || `exit ${probe.code}`}`;
    return { dir: null, error: cachedErr };
  }
  const roots = (probe.output || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "/" && !s.includes("$"));

  const candidates: string[] = [];
  const push = (p: string) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };
  for (const r of roots) {
    push(`${r}/.aso/skills`);
    push(`${r}/.skills`);
  }
  // Termux: $PREFIX/home/.aso/skills (исторический путь)
  for (const r of roots) push(`${r}/home/.aso/skills`);

  const tried: string[] = [];
  for (const dir of candidates) {
    const r = await runCommandCapture(`mkdir -p ${q(dir)} 2>&1 && test -w ${q(dir)} && echo WRITABLE`, undefined);
    const out = (r.output || "").trim();
    if (r.ok && out.includes("WRITABLE")) {
      cachedDir = dir;
      cachedErr = null;
      return { dir };
    }
    tried.push(`${dir}${out ? ` (${out.slice(0, 120)})` : ""}`);
  }
  cachedErr =
    "каталог навыков недоступен ни по одному пути. Пробовал: " +
    (tried.join(", ") || candidates.join(", ") || "(нет кандидатов: не определены $HOME/$PREFIX)");
  return { dir: null, error: cachedErr };
}

/** Совместимость со старым API. */
export async function skillsDir(): Promise<string | null> {
  const { dir } = await resolveSkillsDir();
  return dir;
}

/** Список навыков: имя + description (как progressive disclosure index). */
export async function listSkills(): Promise<{ name: string; description: string }[]> {
  const { dir } = await resolveSkillsDir();
  if (!dir) return [];
  const r = await runCommandCapture(`ls -1 ${q(dir)} 2>/dev/null`, undefined);
  if (!r.ok) return [];
  const names =
    r.output
      ?.split("\n")
      .map((s) => s.trim())
      // один источник навыков: только топ-уровень, без _archive и скрытых
      .filter((s) => s && !s.startsWith(".") && s !== "_archive") ?? [];
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
  const r = await runCommandCapture(`cat ${q(`${dir}/${name}/SKILL.md`)} 2>/dev/null`, undefined);
  if (!r.ok || !r.output) return null;
  return parseSkill(r.output, name);
}

function parseSkill(text: string, name: string): { name: string; description: string; body: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { name, description: "", body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { name: meta.name ?? name, description: meta.description ?? "", body: m[2].trim() };
}

export interface SkillInfo {
  name: string;
  description: string;
  body: string;
}

/**
 * Полный контент навыка (view).
 * Честно отличает «навыка нет» от «хранилище недоступно».
 */
export async function viewSkill(name?: string): Promise<string> {
  const { dir, error } = await resolveSkillsDir();
  if (!dir) return `навыки недоступны: ${error}`;
  if (!name) {
    const list = await listSkills();
    if (!list.length) return `Навыков пока нет. Каталог: ${dir}. Создай первый через skill_manage {action:"save"}.`;
    return `Навыки (${dir}):\n` + list.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) {
    return "ошибка: имя навыка должно быть: латиница/цифры/дефисы/подчёркивания, до 64 симв.";
  }
  const r = await runCommandCapture(`cat ${q(`${dir}/${name}/SKILL.md`)} 2>&1`, undefined);
  const out = (r.output || "").trim();
  if (!r.ok || !out) {
    const list = await listSkills();
    return `Навык «${name}» не найден. Доступные: ${list.map((s) => s.name).join(", ") || "—"}`;
  }
  return out.slice(0, 8000);
}

/** Создать/обновить навык (manage). */
export async function saveSkill(name: string, description: string, body: string): Promise<string> {
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) {
    return "ошибка: имя навыка должно быть: латиница/цифры/дефисы/подчёркивания, до 64 симв.";
  }
  if (!description || !body) return "ошибка: нужны description и тело навыка";
  const { dir, error } = await resolveSkillsDir();
  if (!dir) return `не удалось сохранить навык: ${error}`;

  const content = `---\nname: ${name}\ndescription: ${description.slice(0, 400)}\n---\n\n${body}`;
  // пишем через base64: кавычки/переводы строк не ломаются (RN: без Buffer)
  const b64 = utf8ToBase64(content);
  const cmd = `mkdir -p ${q(`${dir}/${name}`)} && printf '%s' ${q(b64)} | base64 -d > ${q(`${dir}/${name}/SKILL.md`)} && echo SAVED_OK`;
  const r = await runCommandCapture(cmd, undefined);
  const out = (r.output || "").trim();
  if (!r.ok || !out.includes("SAVED_OK")) {
    return (
      `не удалось записать навык в ${dir}/${name}/SKILL.md: ` +
      (out || r.error || `exit ${r.code}`)
    );
  }
  // проверка чтением (T2: тело побайтово)
  const check = await runCommandCapture(`cat ${q(`${dir}/${name}/SKILL.md`)} 2>/dev/null`, undefined);
  if (!check.ok || (check.output || "").trim().length === 0) {
    return `навык записан, но не читается обратно: ${dir}/${name}/SKILL.md`;
  }
  return `Навык «${name}» сохранён: ${content.split("\n").length} строк, ${dir}/${name}/SKILL.md`;
}

/** Удалить навык. */
export async function deleteSkill(name: string): Promise<string> {
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) return "ошибка: некорректное имя навыка";
  const { dir, error } = await resolveSkillsDir();
  if (!dir) return `навыки недоступны: ${error}`;
  const r = await runCommandCapture(`rm -rf ${q(`${dir}/${name}`)} && echo DEL_OK`, undefined);
  return r.ok ? `Навык «${name}» удалён.` : `не удалось удалить: ${(r.output || r.error || `exit ${r.code}`).trim()}`;
}

/** Быстрый поиск навыка по описанию (progressive disclosure). */
export async function findSkill(query: string): Promise<string | null> {
  const list = await listSkills();
  const qq = query.toLowerCase();
  const hit = list.find((s) => s.name.includes(qq) || s.description.toLowerCase().includes(qq));
  return hit ? hit.name : null;
}

/** UTF-8 → base64 без Buffer (RN-safe). */
function utf8ToBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  } catch {
    return btoa(
      unescape(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))),
    );
  }
}
