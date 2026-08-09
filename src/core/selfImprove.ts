/**
 * selfImprove.ts — self-improve агента (как Hermes P1.3).
 *
 * После сложного агентского хода (2+ тула) запускается тихий рецензент:
 * отдельный агентский ход с WHITELIST тулов (memory, skill_view, skill_manage),
 * который анализирует стенограмму хода и:
 *   - если нашёл повторяемый паттерн → сохраняет skill (skill_manage save)
 *   - если узнал важный факт о пользователе → пишет в память (memory add)
 *   - иначе → «ничего нового» (без шума)
 *
 * Приоритет (как Hermes): patch загруженного навыка → новый class-level скилл →
 * support-файл → память. «Тул сломан» = НЕ сохранять паттерн.
 */
import { ModelInfo } from "./gateway";
import { executeTool } from "./tools";

export interface ReviewTranscript {
  /** Количество выполненных тулов. */
  toolCalls: number;
  /** Имена вызванных тулов (уникальные). */
  toolNames: string[];
  /** Краткое резюме: что делал агент, что получилось. */
  summary: string;
  /** Сработал ли тул с ошибкой (такое НЕ учим). */
  hadErrors: boolean;
}

const REVIEWER_SYSTEM = `Ты — рецензент агента (self-improve). Твоя задача — тихо и быстро проанализировать
только что выполненный агентом ход и решить, стоит ли что-то сохранить в долгую память.

Правила:
1. Если ход выявил ПОВТОРЯЕМЫЙ рабочий паттерн (нетривиальная задача решена успешно, подход сработал) —
   сохрани его как навык: вызови skill_manage с action=save (name: латиница/дефисы, description: по чему искать,
   body: шаги/команды/питфоллы). Не дублируй существующие навыки — сначала проверь skill_view (список без name).
2. Если ход выявил ВАЖНЫЙ факт о пользователе (предпочтение, правило, контекст) — сохрани в память:
   memory add target=user (или target=memory для рабочих заметок).
3. Если тул СЛОМАН или ход провалился навсегда — НЕ сохраняй ничего («harden into refusals»: не учим битые паттерны).
4. Если новому учиться нечему — НЕ вызывай тулы, просто ответь «Ничего нового.» одним предложением.
5. Не выдумывай. Сохраняй только то, что реально произошло в ходе.`;

export interface SelfReviewResult {
  reviewed: boolean;
  savedSkill: string | null;
  savedMemory: boolean;
  note: string;
}

/** Порог: рецензент включается после 2+ тулов. */
const REVIEW_TOOL_THRESHOLD = 2;

/** Должен ли сработать рецензент после хода. */
export function shouldSelfReview(t: ReviewTranscript): boolean {
  if (t.hadErrors) return false; // битые паттерны не учим
  return t.toolCalls >= REVIEW_TOOL_THRESHOLD;
}

/**
 * Запустить тихий рецензент. Возвращает результат (никогда не бросает).
 * Никакого UI-шума: всё фоново, модель не «разговаривает», только тулы.
 */
export async function runSelfReview(
  model: ModelInfo,
  transcript: ReviewTranscript,
  signal?: AbortSignal,
): Promise<SelfReviewResult> {
  const result: SelfReviewResult = { reviewed: false, savedSkill: null, savedMemory: false, note: "" };
  if (!model || !shouldSelfReview(transcript)) return result;

  try {
    const { streamAgentChat } = await import("./gateway"); // динамический импорт — против циклов
    const userText = [
      "Стенограмма только что завершённого хода:",
      `Вызвано тулов: ${transcript.toolCalls} (${transcript.toolNames.join(", ")})`,
      `Ошибки: ${transcript.hadErrors ? "да" : "нет"}`,
      `Резюме хода: ${transcript.summary.slice(0, 3000)}`,
      "",
      "Проанализируй и, если есть чему учиться, сохрани навык или факт (по правилам рецензента).",
    ].join("\n");

    let saved: string[] = [];
    // whitelist: рецензенту доступны ТОЛЬКО память и навыки
    const whitelist = ["memory", "skill_view", "skill_manage"];
    const { getToolDefsFor } = await import("./tools");
    const toolDefs = getToolDefsFor(whitelist);

    await streamAgentChat(
      model,
      [
        { role: "user", content: userText },
      ],
      toolDefs,
      {
        onToken: () => {},
        onDone: () => {},
        onError: () => {},
        onToolCall: (call) => saved.push(`${call.name}:${call.arguments.slice(0, 60)}`),
      },
      signal,
    );

    result.reviewed = true;
    result.savedSkill = saved.find((s) => s.startsWith("skill_manage")) ?? null;
    result.savedMemory = saved.some((s) => s.startsWith("memory"));
    result.note = result.savedSkill
      ? `Сохранил навык (${result.savedSkill.slice(0, 80)})`
      : result.savedMemory
        ? "Обновил память"
        : "Ничего нового";
    return result;
  } catch {
    result.note = "Рецензент не сработал (ошибка)";
    return result;
  }
}

/**
 * Куратор навыков (как Hermes curator): старые навыки архивируются в _archive/,
 * НИКОГДА не удаляются. Вызывается при старте приложения и из настроек.
 * Scheduling: навыки, не менявшиеся 30+ дней и имеющие _archive-клон → остаются;
 * простая версия: навыки созданные > 90 дней назад переносятся в архив.
 */
export async function runCurator(): Promise<string> {
  try {
    const { skillsDir, listSkills } = await import("./skills");
    const { runCommandCapture } = await import("./runtime");
    const dir = await skillsDir();
    if (!dir) return "куратор: рантайм недоступен";
    const list = await listSkills();
    const now = Date.now();
    const archiveBase = `${dir}/_archive`;
    let moved = 0;
    for (const s of list.slice(0, 100)) {
      // mtime файла SKILL.md
      const r = await runCommandCapture(`stat -c %Y "${dir}/${s.name}/SKILL.md" 2>/dev/null || echo 0`);
      const mtimeSec = parseInt((r.output || "0").trim(), 10);
      if (Number.isNaN(mtimeSec) || mtimeSec <= 0) continue;
      const ageDays = (now - mtimeSec * 1000) / 86_400_000;
      if (ageDays > 90) {
        await runCommandCapture(`mkdir -p "${archiveBase}" && mv "${dir}/${s.name}" "${archiveBase}/"`);
        moved++;
      }
    }
    return moved > 0 ? `куратор: переместил в архив ${moved} навык(ов)` : "куратор: некого архивировать";
  } catch (e: any) {
    return `куратор: ошибка ${String(e?.message || e)}`;
  }
}