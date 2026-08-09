# Aso-z × Hermes: ROADMAP реализации (агент «как у Hermes», от А до Я)

Источник: полный read-only разбор Hermes Agent v0.17.0 (~/.hermes/hermes-agent/):
104 файла тулов, registry/toolset, инференс (chat_completions + tools + стриминг),
gateway (адаптеры, deliver, MEDIA), скиллы (curator + background review), cron, delegation.
Решение: вариант **А — настоящий function calling** (OpenAI-совместимый chat/completions).

---

## P0 — БАЗА (без этого агент не работает)

### 0.1 Починить терминал (сейчас 126)
- Логировать **stderr** в ExecResult (сейчас «126» без причины).
- После распаковки bootstrap: `chmod 0700` на `bin/*`, `libexec/*`, `lib/apt/*` (как TermuxInstaller).
- **Fix-shebang**: переписать `#!/data/data/com.termux/files/usr/bin/bash` → наш `filesDir/usr/bin/bash` (аналог termux-fix-shebang) во всех скриптах bin/ + libexec/apt/.
- Env перед exec: `PATH=$PREFIX/bin:$PATH`, `PREFIX`, `TERMUX_PREFIX`, `HOME=$PREFIX/home`, `TMPDIR` (создать, Android-`/tmp` нет), `LD_LIBRARY_PATH=$PREFIX/lib`.
- Проверить ABI: `Build.SUPPORTED_ABIS` vs bootstrap (aarch64/arm; x86_64 → свой архив).
- Fallback при SELinux/вендор: proot.
- Семантика как Hermes: stderr→stdout, чанковое чтение 4096, process-group kill, env-снапшот между командами (`export -p` → source), `builtin cd -- <cwd> || exit 126`, маркер CWD.

### 0.2 Function calling + tool loop (вариант А)
- Payload: `POST {base}/chat/completions` c `model`, `messages`, `tools[{type:function,function:{name,description,parameters}}]`, `stream:true`, `stream_options:{include_usage:true}`, `max_tokens` (ключ `max_completion_tokens` для gpt-5+, иначе `max_tokens`). temperature/top_p НЕ слать (дефолт провайдера).
- SSE-парсер: `delta.content` (стрим текста), `delta.reasoning_content|reasoning` (раздумья), `delta.tool_calls` (аккумуляция: **index** — ключ, **name — присваивание** (не +=), **arguments — конкатенация**), `finish_reason`, финальный `usage`.
- Tool loop: assistant-сообщение с `tool_calls` → выполнить тулы → `messages.append({role:"tool", name, tool_call_id, content})` → следующий запрос, пока модель не ответит без tool_calls. Итерации: parent 90 (у нас старт с 8–15), grace-ход при исчерпании.
- Валидация tool_calls: пустые аргументы → `{}`; битый JSON → до 3 ретраев; обрыв без `}` → не выполнять; неизвестное имя → tool-результат «Tool X does not exist. Available: ...».
- Обязательный эхо `reasoning_content` на assistant-сообщениях при реплее (DeepSeek/Kimi 400 без него; паддинг `" "`).

### 0.3 Реестр тулов
- `registry.register(name, toolset, schema, handler, check_fn)`; discovery по каталогу; схемы → OpenAI-формат.
- Toolset-фильтрация (`enabled_toolsets`), TTL-гейтинг `check_fn`, `dynamic_schema_overrides`.
- Первичный набор тулов: `run_command` (терминал), `read_file`/`write_file`/`list_files` (vibe-ФС), `memory`, `todo`, `web_search`, `skill_view`/`skill_manage`, `session_search`, `clarify`, `cronjob`.

### 0.4 Промпт-движок (Hermes-императивы)
- Tool-use enforcement: «You MUST use your tools to take action... Every response should either (a) contain tool calls that make progress, or (b) deliver a final result».
- Finishing the job: «working artifact backed by real tool output — NEVER fabricated output».
- act_dont_ask; Skills mandatory («Err on the side of loading»).
- Системный промпт строится **один раз за сессию, байт-стабильно** (prefix-cache), memory-плагины — в user-сообщение, не в system.

### 0.5 Контекст
- Компрессия при ~50% окна (мин. 64K): prune старых tool-результатов, защита головы/хвоста, LLM-суммаризация середины, сессия-ротация (SQLite), до 3 попыток.
- Таймауты: полный 1800с, stream-read 120с (у нас таймаут уже убран — оставить только кнопку «Стоп»).

---

## P1 — ПАМЯТЬ И ОБУЧЕНИЕ

### 1.1 Memory (как Hermes)
- MEMORY.md («кто пользователь» — USER) / общие заметки; снапшот в system prompt при старте, mid-session записи на диск (не трогать кэш-префикс); лимит символов; `memory` tool (add/replace/remove/batch).
- Правило: память = «кто пользователь и текущее состояние», скиллы = «как делать класс задач».

### 1.2 Скиллы
- SKILL.md + frontmatter (name ≤64, description ≤1024 — по нему поиск), подпапки references/templates/scripts.
- Progressive disclosure: index (name+desc) → full content → linked file. Скиллы НЕ в системном промпте.
- `skill_view`/`skill_manage` (create/edit/patch/delete/write_file), pinned/protected.

### 1.3 Self-improve
- Background review: после хода/каждые ~10 итераций форк-агент с **whitelist (memory+skills only)**; промпт-сигналы (исправления пользователя = сигнал; «тул сломан» = НЕ сохранять — «harden into refusals»); приоритет: patch загруженного → patch зонтика → support-файл → новый class-level скилл.
- Curator: раз в 7 дней (по idle 2ч): active→stale(30д)→archived(90д); **никогда не удалять, только архив**; при delete — `absorbed_into` + миграция ссылок cron-джоб; pinned не трогать.

---

## P2 — АВТОНОМИЯ И ПЛАТФОРМА

### 2.1 Todo + планирование
- `todo` tool: in-memory список, 4 статуса, лимит 256×4000, reinjection после компрессии.

### 2.2 Cron
- jobs.json (тот же формат), schedule kinds: `30m`/once, `every 2h`/interval, cron-5-полей, ISO.
- deliver: origin/local/telegram:<chat>[:thread]/all; MEDIA-теги; no_agent (watchdog: stdout вербатим, пустой = тихо, exit≠0 = алерт).
- context_from (цепочки джоб), workdir (AGENTS.md в промпт), skills[] preload, enabled_toolsets, model override, grace-окна/catch-up, rewrite_skill_refs.

### 2.3 Delegation (субагенты)
- max_concurrent_children=3, max_spawn_depth=1 (flat), leaf/orchestrator, tasks[] батч, background (completion queue → новый ход), max_iterations детей 50, blocked для детей: delegate_task/clarify/memory/send_message/execute_code.

### 2.4 Коммуникации
- Адаптер (Telegram уже есть в приложении как UI): send/edit/delete/media, MEDIA-теги (`MEDIA:<path>`, `[[audio_as_voice]]`, авто-детект путей), home-канал, deliver-роутинг.
- Slash-команды: /new, /model, /retry, /stop, /cron, /skills, /memory, /help, /sethome.
- Hooks (lifecycle): pre_tool_call (блокировка), post_tool_call, transform_llm_output, session start/end, agent:start/end/step.

### 2.5 Медиа/инпут
- vision_analyze: fast-path (мультимодальный tool-result, если модель vision-capable) или aux-модель.
- text_to_speech (Edge TTS бесплатно), image_generate, вложения (уже есть).

---

## Порядок работ (после одобрения)
1. **Терминал P0.1** (stderr/chmod/shebang/env) — одна сборка, проверить `ls`.
2. **Tool loop P0.2 + реестр P0.3** — function calling в gateway, run_command тул, возврат результата модели, петля.
3. **Промпты P0.4** — императивы Hermes.
4. **P1 память/скиллы**, затем **P2** (todo → cron → delegation → hooks).
5. Каждый этап: локальный tsc + web-проверка, ОДНА CI-сборка (лимиты GitHub).