# Доклад: перенос архитектуры Hermes Agent в Aso-z (мозговой штурм)

Исследование исходников `~/.hermes/hermes-agent/` (v0.17.0) + реальных скиллов + кронов.
Read-only. Ориентир: первостепенная задача — ТЕРМИНАЛ.

---

## 1. ПОЧЕМУ У НАС 126 (терминал не выполняет команды) — и как чинить

Ошибка 126 = shell НАШЁЛ файл, но execve не смог: «Permission denied» (EACCES),
«Exec format error» (ENOEXEC) или «command invoked cannot execute» (битый shebang).
Диагностика с устройства по убыванию вероятности:

1. **Нет бита +x** (EACCES). Kotlin ZipInputStream НЕ сохраняет unix-mode из zip.
   TermuxInstaller.java вручную делает `Os.chmod(file, 0700)` для bin/, libexec/, lib/apt/*.
   → Проверить stderr процесса (там будет `ls: Permission denied`), `Os.access(filesDir+/usr/bin/ls, X_OK)`.

2. **Битый shebang**. ВЕСЬ bootstrap собран с PREFIX=`/data/data/com.termux/files/usr` —
   ВСЕ скрипты имеют shebang `#!/data/data/com.termux/files/usr/bin/bash`.
   У нашего приложения data-dir ДРУГОЙ (`/data/user/0/<pkg>/files/usr`) → интерпретатор
   не существует → 126. Это ловит и `ls`, если он обёртка/симлинк.
   → Рецепт: аналог `termux-fix-shebang` — переписать первую строку всех скриптов
   (bin/*, libexec/apt/* и т.п.) под наш `$PREFIX`.

3. **ABI mismatch** (ENOEXEC → «Exec format error»). Если устройство/эмулятор x86_64,
   а bootstrap arm64 — 126. → `Build.SUPPORTED_ABIS`, матчить архив (у нас есть aarch64 + arm; для x86 эмулятора нужен свой).

4. **SELinux/вендор-ROM** (MIUI/EMUI): `avc: denied { execute }` — редко на стоковом AOSP
   (там exec из app-private dir разрешён — иначе сам Termux не работал бы).
   → Логи: `dmesg`/`logcat | grep avc`. Fallback: **proot** (ptrace-эмуляция, не требует
   реального execve, работает в песочнице).

5. **Env до первого exec**: `PATH=$PREFIX/bin:$PATH`, `PREFIX`, `TERMUX_PREFIX`,
   `HOME=$PREFIX/home`, `TMPDIR` (на Android `/tmp` может не существовать!),
   `LD_LIBRARY_PATH=$PREFIX/lib`. Без PATH → 127, без libs → «CANNOT LINK» (не 126, но тоже фейл).

**Первое действие в коде: читать и логировать stderr КОМБИНИРОВАННО** — сейчас «126»
без причины. stderr шелла всегда даёт конкретику (`Permission denied` vs `Exec format error`).

Порядок проверок на устройстве: stderr → chmod 0700 → fix-shebang → ABI → env → SELinux/proot.

---

## 2. ПРОМПТЫ ТУЛОВ HERMES (эталон для «агент должен выполнять команды»)

Ключевые императивы из `prompt_builder.py` (вшиваются в системный промпт):

- **Tool-use enforcement** (гейтится по модели): «You MUST use your tools to take action —
  do not describe what you would do or plan to do without actually doing it… you MUST
  immediately make the corresponding tool call in the same response. Never end your turn
  with a promise of future action… Every response should either (a) contain tool calls
  that make progress, or (b) deliver a final result.»

- **Finishing the job**: «the deliverable is a working artifact backed by real tool output —
  not a description of one… NEVER substitute plausible-looking fabricated output…
  Reporting a blocker honestly is always better than inventing a result.»

- **Skills (mandatory)**: «you MUST load it with skill_view(name) and follow its instructions.
  Err on the side of loading… Only proceed without loading a skill if genuinely none are relevant.»

- **act_dont_ask**: «'Is port 443 open?' → check THIS machine (don't ask 'open where?')» —
  агент должен ДЕЙСТВОВАТЬ, а не переспрашивать.

- **Описания тулов**: `Use this instead of cat/head/tail…` (перехват shell-альтернатив),
  конкретика лимитов/вывода, «REQUIRED when…». Terminal-тул содержит 5 «Do NOT»-подмен,
  правила foreground/background («background… MUST set notify_on_complete=true»),
  запрет nohup/disown/setsid/`&`, «avoid blind sleep loops», pty для интерактива.

**Вывод для Aso-z**: наш системный промпт должен содержать те же жёсткие блоки:
«Ты ОБЯЗАН использовать инструменты» + «доставь рабочий результат» + конкретные описания
инструментов с примерами. Слабые модели слушаются ИМПЕРАТИВОВ + ПРИМЕРОВ ДИАЛОГА, а не
вежливых просьб. Плюс — проверять, что системный промпт реально доходит (логировать payload).

---

## 3. СКИЛЛЫ И SELF-IMPROVE (как учится Hermes)

- **Формат**: `SKILL.md` + frontmatter (name ≤64, description ≤1024 — ПО НЕМУ идёт поиск;
  тело — свободные инструкции). Подпапки: references/ templates/ scripts/ assets/.
- **Подключение**: progressive disclosure — skills_list (только name+description, дёшево) →
  skill_view (полный SKILL.md + список linked files) → skill_view(file_path=…) (тело по требованию).
  Скиллы НЕ в системном промпте — индекс name+description, тело при активации.
- **Self-improve — два механизма**:
  1. **Background review** (после каждого хода/каждые ~10 итераций): форк-агент с
     whitelist-инструментов (только memory + skill), промпт с СИГНАЛАМИ:
     «User corrected your style/workflow — FIRST-CLASS skill signals»,
     «Non-trivial technique emerged», «A loaded skill was wrong — patch it NOW».
     Анти-сигналы: НЕ сохранять environment-фейлы, НЕ сохранять негативные утверждения
     о тулах («X tool is broken» — «these harden into refusals the agent cites against
     itself for months»!).
  2. **Curator** (раз в 7 дней, по idle): детерминированный prune (active→stale(30д)→archived(90д)),
     опц. LLM-консолидация в umbrella-скиллы. Правила: «DO NOT delete, only archive»,
     «DO NOT touch pinned», при delete — обязательный `absorbed_into=<umbrella>` и
     автопереписывание ссылок крон-джоб.
- **Память vs скиллы**: «Memory captures who the user is and the current state;
  skills capture how to do this class of task for this user». Memory вшивается в системный
  промпт снапшотом; скиллы — по требованию.

**Вывод для Aso-z**: минимальный набор = каталог навыков (SKILL.md + index) + фоновый
рецензент после задач (сигналы/анти-сигналы) + периодический куратор (архив, не удаление).

---

## 4. КРОНЫ (механика Hermes, переносится 1:1)

- Расписания: `30m` (once), `every 2h` (interval), `0 9 * * *` (cron), ISO-момент.
- Хранение: `~/.hermes/cron/jobs.json` (формат задокументирован: id, prompt, schedule{kind,expr,minutes},
  repeat, skills[], script, no_agent, context_from, deliver{origin…}, enabled_toolsets, workdir,
  fire_claim, timestamps).
- Доставка: `origin` / `local` / `telegram:<chat_id>[:<thread_id>]` / `all`; MEDIA:-теги в файлы.
- `no_agent=True`: скрипт = джоба (stdout вербатим, пустой stdout = тихо, exit≠0 = алерт).
- `context_from`: цепочки джоб (выход прошлой инжектится в промпт следующей).
- `workdir`: из него в промпт попадают AGENTS.md/CLAUDE.md/.cursorrules, терминал стартует там.
- `skills[]`: ordered preload; `enabled_toolsets`: лимит инструментов джобы.
- Grace-окна и catch-up для опоздавших запусков; скрининг промптов на инъекции.

---

## 5. КАК HERMES ИСПОЛНЯЕТ ШЕЛЛ (семантика для Kotlin/execCapture)

- `bash -l -c "<cmd>"` через Popen; stderr → stdout (одним потоком); `os.setsid` —
  своя process group (kill всей группы при таймауте, анти-зомби).
- Обёртка команды: source снапшота env → `builtin cd -- <cwd> || exit 126` → eval → dump
  `export -p` в снапшот → маркер CWD. Состояние сессии — файл-снапшот, не живой шелл.
- Чтение вывода: select() чанки 4096 + инкрементальный utf-8 (errors=replace).
- Фоновые: `bash -lic "set +m; <cmd>"`, reader-поток, notify/watch_patterns.

**Вывод для Aso-z**: воспроизвести в Kotlin — объединение stderr+stdout, чанковое чтение,
process-group kill, env-снапшот между командами, `set +m` для фоновых.

---

## ПЛАН РЕАЛИЗАЦИИ (следующие шаги, по приоритету)

1. **Терминал (сейчас!)**: stderr в ExecResult; chmod 0700 после распаковки; fix-shebang
   под наш PREFIX (переписать `#!/data/data/com.termux/files/usr/bin/bash` → наш путь);
   env PATH/PREFIX/HOME/TMPDIR/LD_LIBRARY_PATH перед exec; проверка ABI.
   Проверить: `/usr/bin/ls` права, head -c 4 (ELF), шебанги.
2. **Промпт-движок**: встроить блоки Hermes (tool-use enforcement, finishing the job,
   act-don't-ask) + примеры диалога; логировать отправляемый системный промпт.
3. **Скиллы**: SKILL.md-каталог + index + фоновый рецензент + куратор.
4. **Кроны**: jobs.json + воркер (WorkManager/Handler) + deliver-роутинг.