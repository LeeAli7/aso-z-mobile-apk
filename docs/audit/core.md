# Аудит Aso-z Mobile

Репозиторий: `/home/ubuntu/aso-z-mobile-apk` (v1.0.0, HEAD `b9a576e`). Объём: `src/core` — 29 модулей, 5 626 строк; `src/store` — `AppStore.tsx` 426 + `globalStore.ts` 31; нативный слой `modules/aso-runtime` (Kotlin ~1 300 строк + C `pathmap.c`); `assets/` ~170 МБ (`bootstrap/*.zip`, `rootfs/`, `proot/`).

Метод: только чтение кода. Приложение не запускалось, устройства нет. Не проверено вживую: фактическая работа proot на конкретных прошивках, доступность free-эндпоинтов моделей, поведение Android при targetSdk 28.

Классы операций: **СЕТЬ** — реальный HTTP; **ПРОЦЕСС** — запуск нативного процесса через `aso-runtime`; **ФС** — реальные файлы; **AS** — только AsyncStorage; **МАТ** — чистая логика; **ЗАГЛУШКА** — реализации нет.

## 1. Модули `src/core/*.ts`

| Модуль (строк) | Экспортирует | Что делает В РЕАЛЬНОСТИ | Класс | Зависимости / права | Состояние |
|---|---|---|---|---|---|
| `gateway.ts` (857) | `ASOAI_SYSTEM_PROMPT`, `loadModels`, `streamChat`, `streamAgentChat`, `compressContext`, `normalizeChatUrl` | POST `/chat/completions` со SSE к двум зашитым free-эндпоинтам (opencode zen, kilo/openrouter) и к кастомным; для встроенных моделей **нет заголовка Authorization**; анти-обрыв и дозапрос, фолбэк без tools при 400, tool-loop до 8 итераций, парсинг `usage` | СЕТЬ | Интернет; внешние сервисы opencode.ai и api.kilo.ai; для своих провайдеров — ключ из SecureStore | Работает, но зависимость от чужих бесплатных лимитов |
| `tools.ts` (549) | `registerTool`, `getToolDefs`, `getToolDefsGated`, `getToolDefsFor`, `toolNames`, `executeTool`, `utf8ToBase64` | Реестр 12 инструментов; исполнение реальное: команды через рантайм, файлы через рантайм, поиск через сеть, память/задачи через AsyncStorage | СЕТЬ + ПРОЦЕСС + ФС + AS | Рантайм установлен; интернет для web_search | Работает, но 4 из 12 тулов мертвы без рантайма |
| `toolsets.ts` (82) | `TOOLSETS`, `isToolsetEnabled`, `setToolsetEnabled`, `listToolsets`, `enabledTools` | Хранит overrides в `aso_toolsets_overrides`, считает белый список | AS + МАТ | нет | Работает, но гейт применяется только при исполнении, не при выдаче дефов |
| `runtime.ts` (187) | `runtimeAvailable`, `runtimeMode`, `ensureRuntime`, `runCommand`, `runCommandCapture`, `killSession`, `subscribeOutput`, `subscribeExit`, `parseCmdBlocks`, `stripCmdBlocks`, `safeRel` | Мост к нативному модулю: проверка/установка среды, запуск процесса, подписка на stdout, разбор макросов `[CMD:]` | ПРОЦЕСС | Android (iOS/web — нет), распакованный bootstrap в filesDir | Работает на Android arm64 |
| `memory.ts` (152) | `memorySnapshot`, `runMemoryOps`, `clearMemory` | Читает/пишет два блока (`aso_mem_user` 2 200 симв., `aso_mem_memory` 2 200 симв.), форматирует для системного промпта | AS | нет | Работает |
| `sessions.ts` (91) | `loadSessions`, `searchSessions`, `exportSession`, `deleteSession`, `renameSession` | Читает тот же ключ `aso_sessions`, что и AppStore; поиск подстрокой; экспорт в текст | AS | нет | Работает |
| `skills.ts` (142) | `skillsDir`, `listSkills`, `findSkill`, `viewSkill`, `saveSkill`, `deleteSkill` | Файлы `$PREFIX/home/.aso/skills/<имя>/SKILL.md` через рантайм (shell: mkdir/cat) | ФС (через ПРОЦЕСС) | Рантайм в bootstrap-режиме (в proot-режиме `$PREFIX` пуст → каталог не определяется) | Работает только в одном из четырёх режимов |
| `selfImprove.ts` (252) | `runSelfReview`, `shouldSelfReview`, `curatorStatus`, `pinSkill`, `unpinSkill`, `archiveSkill`, `restoreSkill`, `runCurator` | LLM-вызов через `getToolDefsFor` + файловые операции `mv`/`stat` по навыкам; куратор раз в сутки | СЕТЬ + ФС | Рантайм + интернет | Работает при наличии bootstrap-режима |
| `termux.ts` (292) | `exportProjectToShared`, `exportPathsToShared`, `openInTermux`, `openFolderInFileManager`, `projectDirPath`, `nativeIntentsSupported` | Копирует файлы проекта в общую папку через SAF, открывает DocumentsUI через IntentLauncher; `openInTermux` только поднимает рантайм, само приложение Termux не запускает | ФС + Intent | Разрешение на папку (SAF), Android Intent | Работает частично (Termux не открывается) |
| `vibeLocal.ts` (503) | `createProject`, `listProjects`, `deleteProject`, `renameProject`, `treeFiles`, `readFile`, `writeFile`, `createDir`, `deleteFile`, `statPath`, `exportProjectToShared`, `parseFileBlocks`, `copyFile`, `moveFile`, `vibeChat`, `projectStoragePath`, `projectDirPath`, `runCommand` | Реальные файлы в `documentDirectory/vibe/<id>`; `vibeChat` — текстовый стрим без function calling, файлы создаются только по макросам `[FILE:]` после ответа | ФС + СЕТЬ | expo-file-system | Работает (в т.ч. на web) |
| `providers.ts` (211) | `listCustomProviders`, `addCustomProvider`, `updateCustomProvider`, `deleteCustomProvider`, `addCustomModel`, `deleteCustomModel`, `providersToModels`, `providerToModels`, `baseProviderUrl`, `testProvider` | Ключи провайдеров — в SecureStore (Android Keystore); `testProvider` делает реальный HTTP к `/models` | СЕТЬ + SecureStore | Хранилище ключей ОС, интернет | Работает |
| `cron.ts` (243) | `loadJobs`, `upsertJob`, `removeJob`, `getJob`, `setJobEnabled`, `pauseJob`, `resumeJob`, `markJobRun`, `runJobNow`, `nextRunAt`, `dueJobs`, `upcoming`, `clearJobs` | Хранит задания в AsyncStorage, считает расписание арифметикой; само исполнение — вне модуля (тик в ChatScreen) | AS + МАТ | Работающий процесс приложения | Интервальные задания не срабатывают никогда (баг) |
| `backup.ts` (339) | `collectBackup`, `exportBackupToFile`, `importBackupFromFile` | Собирает AsyncStorage-ключи + **секреты из SecureStore**, пишет JSON в Download через SAF, импорт через document-picker | ФС + SecureStore | Разрешение SAF, доступ к Download | Работает, но ключи уходят открытым текстом |
| `agentConfig.ts` (109) | `loadAgentConfig`, `saveAgentConfig`, `DEFAULT_AGENT_CONFIG` | Читает `aso_agent_config` и пять legacy-ключей SettingsScreen | AS | нет | Работает; половина полей никуда не подключена |
| `security.ts` (75) | `loadSecurity`, `saveSecurity`, `isBlockedUrl`, `DEFAULT_SECURITY_CONFIG` | Конфиг approvals/redact; **`isBlockedUrl` не вызывается ни разу** | AS (конфиг) | нет | Половина мертва |
| `delegation.ts` (150) | `runDelegation`, `formatDelegationResults` | Параллельные (до 2) стримы той же модели без инструментов, сбор результатов | СЕТЬ | Интернет | Работает |
| `usage.ts` (83) | `recordUsage`, `getUsageSummary`, `clearUsage` | Пишет токены/счёт из `usage` в `aso_usage` | AS | нет | Пишется, но UI читает статику |
| `webSearch.ts` (100) | `webSearch`, `formatSearchResults` | GET `html.duckduckgo.com/html/?q=` + regex-разбор; на web — через `config.apiBase` | СЕТЬ | Интернет; на web — свой прокси | Работает, хрупко к разметке |
| `env.ts` (39) | `loadApiBase`, `setApiBase`, `config` | Ключ `api_base`, дефолт `http://127.0.0.1:8000` | AS | нет | Работает, дефолт бесполезен на телефоне |
| `sync.ts` (41) | `requestSync`, `pollSync`, `fetchProfile` | fetch к `config.apiBase` (`/sync`, профиль по нику Telegram) | СЕТЬ | Свой бэкенд, которого в репозитории нет | Не работает без сервера |
| `background.ts` (140) | `registerBg`, `unregisterBg`, `listRunning`, `stopBg`, `runningCount` | Реестр в памяти процесса + подмешивает cron-задания; ничего не запускает и не переживает перезапуск | МАТ (in-memory) | нет | Работает как индикатор |
| `kanban.ts` (178) | `createTask`, `listTasks`, `getTask`, `setTaskStatus`, `assignTask`, `commentTask`, `completeTask`, `blockTask`, `unblockTask`, `archiveTask`, `toUiTasks`, `taskStats` | Хранит доски в `aso_kanban_tasks` | AS | нет | **Не импортируется нигде** — движок мёртв |
| `connectors.ts` (270) | `listMcpServers`, `addMcpServer`, `removeMcpServer`, `setMcpEnabled`, `testMcpServer`, `listWebhooks`, `addWebhook`, `removeWebhook`, `setWebhookEnabled`, `platformsStatus`, `toUiMcp`, `toUiWebhooks` | Сохраняет записи в AsyncStorage, `testMcpServer` делает HEAD на URL; JSON-RPC/MCP-клиента и приёма вебхуков нет | AS + СЕТЬ (HEAD) | нет | **Не импортируется нигде** — декорация |
| `voice.ts` (140) | `DEFAULT_VOICE_CONFIG`, `loadVoiceConfig`, `saveVoiceConfig`, `voiceInputAvailable`, `voiceModule`, `startListening`, `stopListening`, `requestVoicePermission` | Обёртка над expo-speech-recognition | AS + платформа | Микрофон/RECORD_AUDIO | **Не импортируется нигде**; в чате голос сделан напрямую (ChatScreen.tsx:148-158) |
| `display.ts` (32) | `loadDisplay`, `saveDisplay` | Читает `aso_theme`/`aso_lang` | AS | нет | **Не импортируется нигде** |
| `crypto.ts` (75) | `getKey`, `decrypt` | XOR + base64, ключ собирается из девяти литералов в бандле | МАТ | нет | Работает; это не шифрование, а обфускация |
| `attachments.ts` (70) | `buildAttachmentParts`, `isTextFile` | Изображение → base64 data-URL; текст → до 8 000 симв.; PDF/DOCX → заглушка «бинарный, встроить не могу» | ФС | expo-file-system, SAF пикер | Работает частично (PDF не парсится) |
| `url.ts` (41) | `normalizeChatUrl` | Собирает корректный `/chat/completions` из базы провайдера | МАТ | нет | Работает (есть smoke-тест) |
| `todo.ts` (124) | `loadTodos`, `runTodoOps`, `clearTodos` | CRUD задач в `aso_todo` | AS | нет | Работает |

## 2. Модули `src/store/*`

| Модуль | Экспортирует | Что делает В РЕАЛЬНОСТИ | Класс | Зависимости | Состояние |
|---|---|---|---|---|---|
| `AppStore.tsx` (426) | провайдер контекста, `useApp`, `useTheme`, `useT`, состояние сессий/моделей/проектов/стрима | Держит всё состояние приложения; на старте: `loadApiBase`, `loadSessions`, `loadModels`, **`ensureRuntime()` (AppStore.tsx:312)**, запуск куратора раз в сутки; сессии — `aso_sessions`, токен/deviceId — SecureStore | AS + СЕТЬ + ПРОЦЕСС | SecureStore, AsyncStorage, рантайм | Работает |
| `globalStore.ts` (31) | `GlobalStore`, провайдер | Шина событий в памяти для оверлеев/диалогов | МАТ | нет | Работает |

## 3. Поток одного сообщения

1. `ChatScreen.tsx:742` — нажатие «отправить» → `sendText` (`ChatScreen.tsx:361`).
2. `ChatScreen.tsx:364` — отсечка пустого ввода и параллельного стрима; `:378` — слэш-команды (`runSlashCommand:284`).
3. `ChatScreen.tsx:396` — сообщение пользователя в стор; `:399` — `markStreaming`.
4. `ChatScreen.tsx:432-435` → `attachments.ts:40` — вложения.
5. `ChatScreen.tsx:441-448` — сбор `agentHistory` (обрезка 30×6 000 симв.); `:455-465` — контекст проекта; `:470-487` → `memory.ts:53` — профиль и память в системный промпт.
6. `ChatScreen.tsx:658` — `getToolDefs()` (`tools.ts:50`), **без учёта выключенных тулсетов**; `:659` — `runtimeAvailable()` (`runtime.ts:32`).
7. `ChatScreen.tsx:660` → `streamAgentChat` (`gateway.ts:423`): `:451` читает `agentConfig`, дальше цикл `:458-462` — `compressContext` (`gateway.ts:386`), `agentRequest` (`gateway.ts:576`), `normalizeChatUrl` (`url.ts:22`), `fetch` (`gateway.ts:614`), разбор SSE (`:642-700`).
8. Если есть `tool_calls`: `gateway.ts:564` → `executeTool` (`tools.ts:96`): `:106-112` гейт тулсетов (`toolsets.ts:71`), `:114-127` approvals (`agentConfig` + `security`), `:129` обработчик, `:134` `redactSecrets`. `run_command` → `tools.ts:217` → `runtime.ts:143` → `ensureRuntime` (`runtime.ts:53`) → `modules/aso-runtime/src/index.ts:85` → `AsoRuntimeModule.kt:173` → `startProcess` (`:1065`) → `detectRuntimeMode` (`:786`) → ветка proot (`:1089`) / bootstrap-proot-map (`:1138`) / bootstrap (`:1195`) / toybox (`:1199`).
9. `gateway.ts:566` — результат кладётся в `messages`, цикл повторяется (лимит `min(8, maxTurns/10)`).
10. `onDone` → `ChatScreen.tsx:590` `finalize` → `:675-683` обрезка истории → `:687` `runSelfReview` (`selfImprove.ts:65`); расход токенов — `gateway.ts:493-498` → `usage.ts:40`.
11. Резервный путь (web или сбой проекции): `ChatScreen.tsx:701` → `streamChat` (`gateway.ts:110`), где `[CMD:]` исполняет `runtime.ts:143`, а `[FILE:]` пишет `vibeLocal.ts:239`.
12. Cron-тик: `ChatScreen.tsx:714-740` → `cron.ts:215 dueJobs` → тот же `sendText`.
13. Правка сообщения: `ChatScreen.tsx:892` → `streamChat` — без инструментов, памяти и контекста проекта.

## 4. Инструменты: реальные и имитации

Реальные (работают при установленном рантайме): `run_command`, `read_file`, `write_file`, `list_files` (все четыре — только Android и только после распаковки bootstrap; на web/iOS дефы модели не отдаются вовсе — `ChatScreen.tsx:659`). Реальные независимо от рантайма: `web_search` (сеть), `memory` (`tools.ts` → `memory.ts`, AsyncStorage), `todo` (`todo.ts`), `session_search` (`sessions.ts`), `delegate_task` (`delegation.ts`, реальные LLM-вызовы), `skill_manage`/`skill_view` (файлы, но см. ниже).

Мёртвые: `skill_manage` и `skill_view` требуют `$PREFIX` в окружении рантайма (есть только в bootstrap-режиме; в proot-режиме `$PREFIX` не экспортируется — `AsoRuntimeModule.kt:1122-1133`), иначе возвращают пустой список/ошибку. Гейт тулсетов (`toolsets.ts`) на пути модели не работает: `ChatScreen.tsx:658` берёт синхронный `getToolDefs()`, выключенный сет модель всё равно видит и только падает на исполнении (`tools.ts:106-112`, это прямо описано в комментарии `tools.ts:92-95`). `approvals` режим smart — регексп-блоклист в `tools.ts:114-127`, обходится кавычками и `find -delete`; `security.isBlockedUrl` не вызывается нигде.

## 5. Терминал, Termux и `modules/aso-runtime`

Нативно исполняется только Android-часть модуля `aso-runtime`: распаковка `assets/bootstrap/bootstrap-aarch64.zip` (или arm) в `filesDir`, распаковка `assets/rootfs/alpine-rootfs-*.tar.gz` и `assets/proot/proot-*-aarch64`, затем `ProcessBuilder` с одним из четырёх режимов (`detectRuntimeMode`, `AsoRuntimeModule.kt:786`): **proot + Alpine rootfs** (предпочтительный, `:1089`), **bootstrap через proot-маппинг** (`:1138`), **bootstrap напрямую** (`:1195`), **toybox `/system/bin/sh`** (`:1199`, деградация без пакетов). Никакого JNI-шелла и запуска системного Termux нет; `pathmap.c` собирается, но `LD_PRELOAD` явно не выставляется — мёртвый легаси-механизм. Termux-интеграция — только `am start` через IntentLauncher (`termux.ts`), при этом сам `openInTermux` его не вызывает. Android-сервис `AsoRuntimeService` объявлен, но в Kotlin-коде нигде не стартует (не проверено статически бинарно — по исходникам ссылок нет). CI (`.github/workflows/build-apk.yml`) принудительно ставит `targetSdkVersion 28`, чтобы обойти ограничения новых Android на исполнение своих бинарей.

## 6. Крипто, ключи, бэкап

Реального шифрования нет: `crypto.ts` — XOR с ключом `AsoZq9x!.ai_gw#2026`, собранным из литералов; `config/encrypted.ts` (28 строк) хранит только base64-строки URL встроенных моделей. Пользовательские API-ключи лежат в **SecureStore** (Android Keystore) под ключами провайдеров, токен синхронизации и deviceId — там же. Память, сессии, задачи, cron, usage — в AsyncStorage открытым текстом. `backup.ts` собирает AsyncStorage **и секреты из SecureStore** и пишет один JSON в папку Download через SAF — то есть бэкап де-факто выгружает все ключи в открытом виде; при импорте шифрование не проверяется (не проверено статически: восстановление в UI не тестировалось).

## 7. Где лежат память, навыки, сессии

- Память: `aso_mem_user`, `aso_mem_memory` (AsyncStorage, лимит 2 200 + 2 200 символов).
- Сессии и вся история чата: `aso_sessions` (AsyncStorage, один JSON-массив со всеми сессиями и `agentHistory`).
- Задачи: `aso_todo`; канбан: `aso_kanban_tasks`; cron: ключ заданий; usage: `aso_usage`; тулсеты: `aso_toolsets_overrides`.
- Навыки: реальные файлы `$PREFIX/home/.aso/skills/<имя>/SKILL.md` внутри файловой системы рантайма, то есть **вне AsyncStorage** и видны только при работающем bootstrap-режиме.
- Проекты vibe: `documentDirectory/vibe/<id>` (реальные файлы, доступны и без рантайма).
- Конфиг агента: `aso_agent_config` + пять legacy-ключей.

## 8. Что нарисовано, но не работает

`UsageScreen` показывает нули с комментарием «заглушка до движка usage» — при том что `usage.ts` реально пишет данные; `KanbanScreen` и `ConnectorsScreen` держат собственные сторы на тех же ключах, что мёртвые движки `kanban.ts`/`connectors.ts`; три пункта `AgentScreen` («Agent Swarm», «Kimi Claw», «Кодер») ведут на один и тот же канбан; синхронизация по нику Telegram требует бэкенда, которого в репозитории нет (`apiBase` по умолчанию `127.0.0.1:8000`); переключатели `memoryEnabled`/`userProfileEnabled` в настройках ни на что не влияют (память вшивается всегда, `ChatScreen.tsx:470-487`); `approvalsTimeoutSec` и `compressionThreshold` из конфига не читаются; `run_command` на iOS/web отсутствует, но UI это не подсвечивает явным баннером.

## 9. Слабые места, которые придётся чинить первыми

1. **Рантайм с четырьмя режимами работы.** `detectRuntimeMode` и три пути запуска (`AsoRuntimeModule.kt:786-1200`) — главный источник неопределённости: одно и то же приложение ведёт себя по-разному на разных прошивках, а `$PREFIX` существует только в bootstrap-режиме, из-за чего навыки и куратор молча ломаются. Перед редизайном надо зафиксировать один поддерживаемый режим либо дать UI явный индикатор и деградацию.
2. **Гейт тулсетов и настройки агента не влияют на промпт.** `ChatScreen.tsx:658` отдаёт модели все дефы, `memoryEnabled`/`approvalsTimeoutSec`/`compressionThreshold` не читаются. Пользователь видит переключатели, которые ничего не переключают.
3. **Cron не работает для интервалов.** `cron.ts:nextRunAt` при `lastRunAt === null` берёт `now` как базу, поэтому задание `30m`/`every 2h` никогда не становится due; исполнение вдобавок живёт в тике экрана чата — ушёл с экрана, планировщик остановился.
4. **Хранение состояния в AsyncStorage без модели данных.** Сессии, память, канбан, задачи, cron, usage — плоские JSON в одном хранилище, без версий и миграций; история хранится репликами до 6 000 символов × 30, что упирается в лимит SQLite на Android. Любой рефакторинг формата потребует миграции.
5. **Дублирование источников правды.** `kanban.ts`, `connectors.ts`, `voice.ts`, `display.ts` не импортируются, а экраны пишут их же ключи своими сторами. При переделке это надо либо удалить, либо поднять в движок — иначе UI продолжит расходиться.
6. **Ключи и бэкап.** `backup.ts` выгружает SecureStore-секреты в `Download/*.json` открытым текстом; собственного шифрования нет (`crypto.ts` — XOR). Для продукта, который хранит ключи к платным провайдерам, это прямой утечка-риск.
7. **Модели на чужих бесплатных эндпоинтах.** Встроенные модели ходят на opencode zen и kilo без ключа, с подменой UA и XOR-обфускацией адресов; смена политики провайдера или Cloudflare-правил кладёт всё приложение, fallback на другого провайдера при 429/403 нет (ретраи идут в тот же URL).
8. **Сеть с дефолтом localhost.** `sync.ts` и web-прокси `gateway.ts` завязаны на `config.apiBase` со значением `127.0.0.1:8000`; серверной части в репозитории нет, то есть синхронизация и web-режим мертвы из коробки.
9. **Безопасность инструментов.** `write_file` не проверяет выход за каталог проекта (абсолютные пути и `..` проходят), блок-лист `isBlockedUrl` не применяется, approvals — регексп-список из нескольких шаблонов, `redactSecrets` — шесть регулярных выражений. При агентском режиме с автоматическими вызовами этого мало.
10. **Отсутствие тестов и хрупкий протокол агента.** В репозитории один smoke-тест `url.smoke.mjs`; при этом анти-обрыв, дозапрос обрезанных ответов, фолбэк без tools при 400, лимит итераций `min(8, maxTurns/10)` и отдельный plain-путь для правки сообщения (`ChatScreen.tsx:892`, без инструментов и памяти) — всё непокрытая логика, которая уже сейчас даёт несогласованное поведение.

Плюс к этому — ~170 МБ ассетов в APK (bootstrap + rootfs + proot), принудительный `targetSdkVersion 28` в CI и распаковка среды при первом запуске на устройстве: это ограничивает и размер дистрибутива, и список поддерживаемых устройств.