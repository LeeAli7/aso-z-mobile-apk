# Карта интерфейса Aso-z mobile (`/home/ubuntu/aso-z-mobile-apk`)

Источник истины — код: `App.tsx` (навигация), `src/screens/*`, `src/components/*`. Все ссылки вида `Файл:строка` — фактические номера строк в текущем репозитории (режим только чтения, ничего не менялось).

## 0. Навигационный каркас

```
App()                                    App.tsx:143
└─ GestureHandlerRootView (155) → SafeAreaProvider → AppProvider (157)
   └─ OnboardingGate                     App.tsx:158 (компонент :116)
      ├─ state='onboarding' → OnboardingScreen (вне стека, проп onDone)
      └─ state='done'       → ThemedApp (:95) → RootNav (:64)
         └─ NavigationContainer → Stack.Navigator (headerShown:false)
            Main(80) → Vibe(81) → VibeProject(82) → Settings(83) → Agents(84)
            → AgentSettings(85) → Providers(86) → Connectors(87) → Kanban(88) → Usage(89)
```

Маршрутов в стеке — **10** (`App.tsx:80-89`), файлов экранов — **11** (`OnboardingScreen` маршрута не имеет).
Вход в экраны почти всегда из одного места — боковое меню `DrawerLineArt` (`onNavigate` → `ChatScreen.openDrawerRoute` → `navigation.navigate(route)`), плюс точечные `navigate` из `SettingsScreen`, `VibeScreen`, `AgentScreen`.

## 1. ЭКРАНЫ

| # | Файл | Маршрут | Назначение | Из чего состоит (блоки) |
|---|------|---------|-----------|--------------------------|
| 1 | `src/screens/ChatScreen.tsx` (1555 стр.) | `Main` | Главный экран: чат с агентом, сессии, вложения, фоновые задачи | Плавающая шапка (бургер / заголовок `chat_title` / `BgIndicator` / ＋) · `FlatList` сообщений: группы `kind='chain'` (внутри `Glass` → `ThinkingBlock` + `ToolCard` + строки действий) и `kind='single'` → `Bubble` · `EmptyChat` (приветствие, рендер `ChatScreen.tsx:1073`, определение :1543) · композер: ряд чипов вложений → `Glass`-капсула (＋ прикрепить, `TextInput`, кнопка Стоп/Отправить/Микрофон) · 8 шторок (`DrawerLineArt`, `StorageSheet`, `BgTasksSheet`, msg-menu, detail, edit, attach, rename, delete) |
| 2 | `src/screens/VibeScreen.tsx` (492) | `Vibe` | Рабочая среда агента: проекты, файлы, память, todo, cron, навыки | Шапка (назад/заголовок/＋ только в «Проекты») · корень-проводник: две группы `DeptRow` («Проекты», «Файлы агента») + группа «Агент» («Память», «Задачи», «Автозадачи», «Скиллы») · подэкраны по `dept`: `FlatList` проектов с `IconButton more`, `FlatList` файлов (read-only), карточка памяти + удаление, todo-список + инлайн-добавление, cron-список со свитчами, read-only список скиллов · `Sheet` создания проекта · `Sheet` меню проекта |
| 3 | `src/screens/VibeProjectScreen.tsx` (637) | `VibeProject` (`{id,name}`) | Один vibe-проект: чат агента по проекту + файловый менеджер | Шапка (назад, имя, модель · путь, 2 иконки: папка в ФМ / Termux) · табы `chat` / `files` · вкладка chat: `FlatList` сообщений (`ThinkingBlock`, `ToolCard`, markdown) + композер (input, Стоп, Отправить) · вкладка files: путь «Наверх», «папка», «файл», `FlatList` записей (тап — открыть/войти, долгое — меню) · 6 шторок: просмотр файла, редактор, новый файл, новая папка, меню файла, переименование, удаление |
| 4 | `src/screens/SettingsScreen.tsx` (557) | `Settings` | Настройки: аккаунт, агент, тема/язык, голос, память, безопасность, делегация, данные, о приложении | Шапка + корень-список из 9 `DeptRow` (`SettingsScreen.tsx:249-258`) · подэкраны: `account` (аватар, квота, синк, выход), `agent` (max_turns/approvals chips, compress switch, →Providers), `appearance` (тема/язык chips), `voice` (STT switch, STT/TTS провайдеры chips), `memory` (switch + →AgentSettings), `security` (switch), `delegation` (chips + →AgentSettings), `data` (экспорт/импорт/очистка), `about` (версия, лицензия) |
| 5 | `src/screens/ProvidersScreen.tsx` (403) | `Providers` | Провайдеры и модели: системные + кастомные | Шапка · корень из 3 `DeptRow` (`sysmodels`, `myproviders`, `mymodels`) · `SystemProvider` (read-only) · `FlatList` кастомных провайдеров с раскрытием, иконками edit/delete, «＋ Добавить модель» · фиксированная кнопка «＋ Добавить провайдера» · `Sheet` формы провайдера (Наименование, Endpoint, API-ключ, Сохранить) · `Sheet` формы модели (имя, temperature, system prompt, Проверить, Сохранить) |
| 6 | `src/screens/ConnectorsScreen.tsx` (200) | `Connectors` | Интеграции: мессенджеры, MCP-серверы, webhooks | Шапка · корень из 3 `DeptRow` · `messengers`: карточка статуса Telegram (read-only) + строка Discord «soon» · `mcp`: список + удаление + инлайн-форма (имя, команда/URL) · `webhooks`: то же (имя, события) |
| 7 | `src/screens/KanbanScreen.tsx` (131) | `Kanban` | Доска TODO/DOING/DONE на локальном сторe | Шапка · три секции-колонки с счётчиками · карточки (тап — вперёд по `NEXT`, × — удалить) · нижняя форма (title, assignee) + «Создать» |
| 8 | `src/screens/UsageScreen.tsx` (82) | `Usage` | Расход токенов (заглушка) | Шапка · 3 карточки-суммы · блок «Модели» (пустое состояние). `const STATS = []` (`UsageScreen.tsx:18`) — цифр не будет никогда |
| 9 | `src/screens/AgentScreen.tsx` (118) | `Agents` | Раздел «Агенты»: субагенты, ссылки на Kanban/Usage/настройки | Шапка · корень из 3 `DeptRow` (`subagents`, `kanban`, `usage`) · подэкран `subagents`: 4 карточки `AGENTS` (`Agent Swarm`, `Kimi Claw`, `Кодер`, `Терминал`) + строка «Настройки агента: память, навыки» |
| 10 | `src/screens/AgentSettingsScreen.tsx` (396) | `AgentSettings` | Память / навыки (SKILL.md) / задачи / автозадачи | Шапка · секции: «Память» (текст + «Очистить память»), «Навыки (SKILL.md)» (список с открытием тела, удалением, формой создания, «Запустить куратора»), «Задачи» (todo-список, добавление, удаление, очистка), «Автозадачи» (список со `Switch`, удаление, форма создания) |
| 11 | `src/screens/OnboardingScreen.tsx` (573) | — (гейт, `App.tsx:116-142`) | 5 слайдов первого запуска с разрешениями | Фон-glow + точки прогресса · `Slide` (title, body, карточка «где включить» для системных настроек) · кнопка primary (`onPrimary`) + ghost «Пропустить» (`onGhost`). Слайды: «Твой личный AI-агент в кармане» (`next`), «Доступ ко всем файлам» (`files`), «Работа без ограничений батареи» (`battery`), «Уведомления о работе агента» (`notifications`), «Всё настроено! Погнали» (`done`, пишет `aso_onboarding_done`) |

## 2. КНОПКИ / СТРОКИ / ДЕЙСТВИЯ

> Пути сокращены: `ChatScreen.tsx` = `src/screens/ChatScreen.tsx`, `DrawerLineArt.tsx` = `src/components/DrawerLineArt.tsx` и т. д.

### 2.1 ChatScreen (`Main`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Main | Бургер в шапке | `setDrawerOpen(true)` → шторка `DrawerLineArt` | ChatScreen.tsx:1028 |
| Main | `BgIndicator` (точка+счётчик, рендерится только при `count>0`) | `setBgOpen(true)` → `BgTasksSheet` | ChatScreen.tsx:1032 |
| Main | ＋ в шапке | `handleNewSession()` → `newSession(); setActive(id); setDrawerOpen(false); setText('')` | ChatScreen.tsx:1033 → :780 |
| Main | ＋ в капсуле ввода | `setAttachOpen(true)` → шторка «Прикрепить» | ChatScreen.tsx:1196 |
| Main | «Фото» / «Камера» / «Файл» в шторке | `pickImage` / `pickCamera` / `pickFile` (expo-image-picker / document-picker) | ChatScreen.tsx:1356-1358 → :235 / :253 / :270 |
| Main | × на чипе вложения | `setAttachments(prev.filter((_, i) => i !== ai))` | ChatScreen.tsx:1183 |
| Main | Кнопка «Отправить» (когда `text.trim()`) | `send()` → `sendText(text)` (агентский цикл, tool-вызовы) | ChatScreen.tsx:1241 → :742 → :361 |
| Main | Кнопка «Остановить» (пока `isStreaming`) | `getRun(s).stop = true; ctrl.abort(); markStreaming(s, false)` | ChatScreen.tsx:1227 |
| Main | Кнопка «Голосовой ввод» (когда текст пуст) | `toggleVoice()` — `expo-speech-recognition` start/stop, язык из `state.lang` | ChatScreen.tsx:1250 → :138 |
| Main | Долгое нажатие (350 мс) на пузыре | `msgMenu(msg)` → шторка действий | ChatScreen.tsx:1470-1472 → :762 |
| Main | Иконка «Копировать» в строке действий цепочки | `copyMsg(m)` → Clipboard | ChatScreen.tsx:1118 → :231 |
| Main | Иконка «Поделиться» в цепочке | `shareMsg(m)` → Share | ChatScreen.tsx:1121 → :232 |
| Main | «Копировать» / «Поделиться» / «Изменить» у пузыря | `onCopy` / `onShare` / `onEdit` (edit — только user) | ChatScreen.tsx:1524 / :1527 / :1532 |
| Main | `ThinkingBlock` (после завершения, есть текст) | `onOpen` → `setDetailTarget(m)` → шторка «Думаю» | ChatScreen.tsx:1099, :1514 → :1307 |
| Main | `ToolCard` (любой тап) | `onOpen` → `setDetailTarget(m)` → шторка «Ход выполнения» | ChatScreen.tsx:1109, :1449 |
| Main | Шторка сообщения: «Повторить запрос» | `retryMsg(m)` → `sendText(предыдущий user-content)` | ChatScreen.tsx:1297 → :747 |
| Main | Шторка сообщения: «Копировать» / «Поделиться» | `copyMsg` / `shareMsg`, закрытие шторки | ChatScreen.tsx:1299 / :1300 |
| Main | Шторка сообщения: «Удалить сообщение» | `doDeleteMsg` → `dispatch DELETE_MSG` + toast | ChatScreen.tsx:1301 → :769 |
| Main | Шторка «Изменить сообщение»: «Отправить» | `confirmEdit` — перезапрос с изменённым текстом | ChatScreen.tsx:1345 → :838 |
| Main | Шторка «Изменить сообщение»: «Отмена» | `setEditTarget(null)` | ChatScreen.tsx:1342 |
| Main | Шторка «Переименовать сессию»: «Сохранить» / Enter | `confirmRename` → `renameSessionById` (UPDATE_SESSION) | ChatScreen.tsx:1400 / :1392 → :922 |
| Main | Шторка «Переименовать сессию»: «Отмена» | `setRenameTarget(null)` | ChatScreen.tsx:1397 |
| Main | Шторка «Удалить сессию?»: «Удалить» | `confirmDeleteSession` → `deleteSession(id)` | ChatScreen.tsx:1419 → :806 |
| Main | Шторка «Удалить сессию?»: «Отмена» | `setDeleteTarget(null)` | ChatScreen.tsx:1416 |
| Main | `DrawerLineArt` — прокинутые обработчики | `onSelectModel=switchModel`, `onNewChat`, `onNavigate=openDrawerRoute`, `onSelectSession=openDrawerSession`, `onSearchChange`, `onRename`, `onDelete` | ChatScreen.tsx:1264-1281 (`switchModel` :932, `openDrawerRoute` :793, `openDrawerSession` :787, `renameSessionById` :812, `deleteSessionById` :798) |
| Main | `BgTasksSheet` — «глаз» | `onOpen` → `setBgOpen(false)` (просто закрыть) | ChatScreen.tsx:1068 |
| Main | `BgTasksSheet` — «стоп» | `onStop`: `runtime` → `killSession(sid)`, `stream` → abort + `markStreaming(false)`, иначе закрыть лист | ChatScreen.tsx:1045-1067 |

### 2.2 DrawerLineArt (боковое меню, `src/components/DrawerLineArt.tsx`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Main (шторка) | Тап по backdrop | `animateClose()` | DrawerLineArt.tsx:163 |
| Main (шторка) | «Новый чат» | `onNewChat` → `handleNewSession` | DrawerLineArt.tsx:189 |
| Main (шторка) | Поле поиска сессий | `onSearchChange` → `setSearch` (фильтр `sessionList` в ChatScreen) | DrawerLineArt.tsx:278-280 |
| Main (шторка) | Строка модели в списке | `onSelectModel(m)` → `switchModel` (модель сессии + `setDefaultModel`) | DrawerLineArt.tsx:219 → ChatScreen.tsx:932 |
| Main (шторка) | Строка «Провайдеры» | `onNavigate('Providers')` | DrawerLineArt.tsx:243 |
| Main (шторка) | «Агенты» | `onNavigate('Agents')` | DrawerLineArt.tsx:265 |
| Main (шторка) | «Vibe» | `onNavigate('Vibe')` | DrawerLineArt.tsx:266 |
| Main (шторка) | «Коннекторы» | `onNavigate('Connectors')` | DrawerLineArt.tsx:267 |
| Main (шторка) | «Kanban» | `onNavigate('Kanban')` | DrawerLineArt.tsx:268 |
| Main (шторка) | «Использование» | `onNavigate('Usage')` | DrawerLineArt.tsx:269 |
| Main (шторка) | «Настройки» | `onNavigate('Settings')` | DrawerLineArt.tsx:270 |
| Main (шторка) | Строка сессии | `onSelectSession(s.id)` → `openDrawerSession` | DrawerLineArt.tsx:294 → ChatScreen.tsx:787 |
| Main (шторка) | Карандаш у сессии | `onRename(s.id)` → шторка переименования | DrawerLineArt.tsx:309 → ChatScreen.tsx:812 |
| Main (шторка) | Корзина у сессии | `onDelete(s.id)` → шторка удаления | DrawerLineArt.tsx:312 → ChatScreen.tsx:798 |
| — | Все `onNavigate` | `openDrawerRoute(route)` → `setDrawerOpen(false); navigation.navigate(route)` | ChatScreen.tsx:793-796 |

### 2.3 VibeScreen (`Vibe`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Vibe | Назад в шапке | `dept ? setDept(null) : navigation.goBack()` | VibeScreen.tsx:173 |
| Vibe | ＋ в шапке (только `dept==='projects'`) | `setCreateOpen(true)` — шторка ручного создания | VibeScreen.tsx:180-183 |
| Vibe | `DeptRow` «Проекты» / «Файлы агента» | `setDept(d.key)` | VibeScreen.tsx:197 |
| Vibe | `DeptRow` «Память» / «Задачи» / «Автозадачи» / «Скиллы» | `setDept(d.key)` | VibeScreen.tsx:208 |
| Vibe | `DeptBack` «Назад» | `setDept(null)` | VibeScreen.tsx:217 |
| Vibe | Карточка проекта | `navigation.navigate('VibeProject', { id: item.id, name: item.name })` | VibeScreen.tsx:240 |
| Vibe | `IconButton more` на карточке | `setMenuProject(item); setRenameText(item.name)` → шторка меню проекта | VibeScreen.tsx:266-269 |
| Vibe | Память → «Удалить» | `Alert.alert` → `clearMemory()` + текст «Память пуста.» | VibeScreen.tsx:313-324 |
| Vibe | Todo строка (тап) | `runTodoOps([{action:'update', status: toggle}])` | VibeScreen.tsx:336-341 |
| Vibe | Todo × (удалить одну) | `runTodoOps([{action:'remove', id}])` | VibeScreen.tsx:348-352 |
| Vibe | Todo поле + «Создать» | `runTodoOps([{action:'add', content}])` | VibeScreen.tsx:361 → :362-370 |
| Vibe | Todo «Удалить» (все) | `clearTodos(); setTodos([])` | VibeScreen.tsx:375-376 |
| Vibe | Cron: иконка-кружок | `setJobEnabled(j.id, !j.enabled)` | VibeScreen.tsx:392-396 |
| Vibe | Cron: корзина | `removeJob(j.id)` | VibeScreen.tsx:405-409 |
| Vibe | Шторка создания: «Создать» | `create()` → `createProject(name, desc)`, тост | VibeScreen.tsx:442 → :117 |
| Vibe | Шторка меню: «Экспорт» | `treeFiles(menuProject.id)` → `Share.share` (текстом, не zip) | VibeScreen.tsx:449-466 |
| Vibe | Шторка меню: «Переименовать» | `renameProject(id, renameText)` — **фактически no-op**, см. мёртвые места | VibeScreen.tsx:468-483 |
| Vibe | Шторка меню: «Удалить» | `remove(menuProject)` | VibeScreen.tsx:485 → :135 |
| Vibe | Список «Файлы агента» | действий нет, только просмотр | VibeScreen.tsx:280-304 |
| Vibe | Список «Скиллы» | read-only карточки | VibeScreen.tsx:423-433 |

### 2.4 VibeProjectScreen (`VibeProject`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| VibeProject | Назад | `navigation.goBack()` | VibeProjectScreen.tsx:302 |
| VibeProject | Иконка «папка» | `openFolderInFileManager(projectId)` (+тост об ошибке) | VibeProjectScreen.tsx:312-315 |
| VibeProject | Иконка «терминал» | `openInTermux(projectId)` (+тосты) | VibeProjectScreen.tsx:321-325 |
| VibeProject | Табы `chat` / `files` | `setMode(m)` | VibeProjectScreen.tsx:336-338 |
| VibeProject | Поле «Инструкция агенту…» | `setText` | VibeProjectScreen.tsx:382 |
| VibeProject | Кнопка «Стоп» (в busy) | `stop()` → `stopRef.current = true; abortRef.abort()` | VibeProjectScreen.tsx:390 → :178 |
| VibeProject | Кнопка «Отправить» | `send()` → `vibeChat(...)` с onToken/onThinking/onTool/onDone/onError | VibeProjectScreen.tsx:394 → :119 |
| VibeProject | «Наверх» | `goUp()` | VibeProjectScreen.tsx:408 → :257 |
| VibeProject | «папка» | `setNewDirOpen(true)` | VibeProjectScreen.tsx:417 |
| VibeProject | «файл» | `setNewFileOpen(true)` | VibeProjectScreen.tsx:421 |
| VibeProject | Строка файла: тап | `item.isDir ? openDir(name) : viewFile(rel)` | VibeProjectScreen.tsx:439 → :252 / :184 |
| VibeProject | Строка файла: долгое нажатие | `setFileMenu({name, isDir})` | VibeProjectScreen.tsx:440 |
| VibeProject | Шторка «Файл»: «Копировать» | `Clipboard.setStringAsync` + тост | VibeProjectScreen.tsx:456 |
| VibeProject | Шторка «Файл»: «Экспорт» | `Share.share({message: fileContent})` | VibeProjectScreen.tsx:457 |
| VibeProject | Шторка «Файл»: «Редактировать» | `startEdit(viewName)` | VibeProjectScreen.tsx:458 → :204 |
| VibeProject | Шторка «Правка»: «Сохранить» / «Отмена» | `saveEdit` / `setEditOpen(false)` | VibeProjectScreen.tsx:479 / :478 → :215 |
| VibeProject | Шторка «Новый файл»: «Создать» | инлайн-`async` → запись файла + `refreshDir()` | VibeProjectScreen.tsx:502 |
| VibeProject | Шторка «Новая папка»: «Создать» | то же для каталога | VibeProjectScreen.tsx:530 |
| VibeProject | Меню файла: «Открыть» / «Редактировать» / «Переименовать» / «Удалить» | `viewFile` / `startEdit` / `setRenameTarget` / `setDeleteTarget` | VibeProjectScreen.tsx:544 / :547 / :549 / :550 |
| VibeProject | Переименование: «Сохранить» | `confirmRename` | VibeProjectScreen.tsx:569 → :269 |
| VibeProject | Удаление: «Удалить» | `confirmDelete` | VibeProjectScreen.tsx:582 → :284 |

### 2.5 SettingsScreen (`Settings`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Settings | Назад | `dept ? setDept(null) : navigation.goBack()` | SettingsScreen.tsx:264 |
| Settings | 9 `DeptRow` корня (Аккаунт, Агент, Внешний вид, Голос, Память, Безопасность, Делегация, Данные, О приложении) | `setDept(d.key)` | SettingsScreen.tsx:275-280 |
| Settings | `DeptBack` | `setDept(null)` | SettingsScreen.tsx:285 |
| Settings | Аккаунт: «Удалить»/logout | `logout` → `SET_TOKEN null`, `SET_PROFILE null`, `SET_SYNC idle` | SettingsScreen.tsx:329 |
| Settings | Аккаунт: поле username + «Отправить» | `doSync()` → `requestSync` / `pollSync` / `fetchProfile` | SettingsScreen.tsx:336 / :338 |
| Settings | Аккаунт: «Отменить» (в процессе) | `cancelSync()` | SettingsScreen.tsx:345 |
| Settings | Агент: chips max_turns `30/90/200` | `setPref('maxTurns', v)` | SettingsScreen.tsx:364 |
| Settings | Агент: chips approvals `smart/manual/off` | `setPref('approvals', v)` | SettingsScreen.tsx:372-378 |
| Settings | Агент: `Switch` «Сжатие» | `setPref('compression', '1'/'0')` | SettingsScreen.tsx:385-391 |
| Settings | Агент: строка «Провайдеры» | `navigation.navigate('Providers')` | SettingsScreen.tsx:394 |
| Settings | Внешний вид: chips темы `light/dark/system` | `setTheme(th)` → `SET_THEME` | SettingsScreen.tsx:405 |
| Settings | Внешний вид: chips языка `RU`/`EN` | `setLang('ru'/'en')` → `SET_LANG` | SettingsScreen.tsx:413-414 |
| Settings | Голос: `Switch` STT | `setPref('sttEnabled', ...)` | SettingsScreen.tsx:425-431 |
| Settings | Голос: chips STT-провайдера `local/groq/openai/mistral` | `setPref('sttProvider', v)` | SettingsScreen.tsx:437-438 |
| Settings | Голос: chips TTS-провайдера `edge/elevenlabs/openai/gemini` | `setPref('ttsProvider', v)` | SettingsScreen.tsx:446-447 |
| Settings | Память: `Switch` | `setPref('memoryEnabled', ...)` | SettingsScreen.tsx:459-465 |
| Settings | Память: строка «Агент: память, навыки, задачи» | `navigation.navigate('AgentSettings')` | SettingsScreen.tsx:468 |
| Settings | Безопасность: `Switch` «Скрывать секреты» | `setPref('redactSecrets', ...)` | SettingsScreen.tsx:477-483 |
| Settings | Делегация: chips `1/3/5` | `setPref('delegationMax', v)` | SettingsScreen.tsx:494-495 |
| Settings | Делегация: строка «Агент: автозадачи, куратор» | `navigation.navigate('AgentSettings')` | SettingsScreen.tsx:500 |
| Settings | Данные: «Экспорт данных» | `exportData()` → `exportBackupToFile()` | SettingsScreen.tsx:507 → :199 |
| Settings | Данные: «Импорт данных» | `importData()` → `importBackupFromFile()` + `globalThis.location.reload()` | SettingsScreen.tsx:509 → :205 |
| Settings | Данные: «Очистить все данные» | `wipeAll()` — Alert → чистка AsyncStorage/SecureStore/папки `vibe` | SettingsScreen.tsx:511-518 → :218 |
| Settings | О приложении | только текст, кнопок нет | SettingsScreen.tsx:523-538 |

### 2.6 ProvidersScreen (`Providers`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Providers | Назад | `dept ? setDept(null) : navigation.goBack()` | ProvidersScreen.tsx:88 |
| Providers | 3 `DeptRow` (`sysmodels`, `myproviders`, `mymodels`) | `setDept(d.key)` | ProvidersScreen.tsx:99 |
| Providers | Карточка провайдера | `toggleExpand(item.id)` | ProvidersScreen.tsx:139 |
| Providers | Иконка «редактировать» | `setEditProvider(item); setProviderForm(true)` | ProvidersScreen.tsx:148 |
| Providers | Иконка «удалить» | `removeProvider(item)` — **без подтверждения** | ProvidersScreen.tsx:151 → :60 |
| Providers | Строка модели → «редактировать» | `setModelForm({ provider: item, model: m })` | ProvidersScreen.tsx:174 |
| Providers | Строка модели → «удалить» | `removeModel(item, m)` — без подтверждения | ProvidersScreen.tsx:177 → :69 |
| Providers | «＋ Добавить модель» | `setModelForm({ provider: item })` | ProvidersScreen.tsx:182 |
| Providers | «＋ Добавить провайдера» (плавающая) | `setEditProvider(null); setProviderForm(true)` | ProvidersScreen.tsx:193 |
| Providers | Форма провайдера: «Сохранить» | `save` (валидация `valid`, `saving`) | ProvidersScreen.tsx:274 |
| Providers | Форма модели: «Проверить» | `runTest()` — сетевой тест модели | ProvidersScreen.tsx:357 |
| Providers | Форма модели: «Сохранить» | `save` | ProvidersScreen.tsx:360 |

### 2.7 ConnectorsScreen (`Connectors`)

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Connectors | Назад | `navigation.goBack()` | ConnectorsScreen.tsx:104 |
| Connectors | 3 `DeptRow` (`messengers`, `mcp`, `webhooks`) | `setDept(d.key)` | ConnectorsScreen.tsx:119 |
| Connectors | `DeptBack` | `setDept(null)` | ConnectorsScreen.tsx:126 |
| Connectors | Telegram / Discord (вкладка «Мессенджеры») | **кнопок нет** — только статус; Discord всегда «soon» | ConnectorsScreen.tsx:130-142 |
| Connectors | MCP: корзина | `delMcp(m.id)` | ConnectorsScreen.tsx:157 → :66 |
| Connectors | MCP: имя/команда + «Создать» | `addMcp()` → AsyncStorage `aso_mcp_servers` | ConnectorsScreen.tsx:163-167 → :56 |
| Connectors | Webhooks: корзина | `delWh(w.id)` | ConnectorsScreen.tsx:183 → :81 |
| Connectors | Webhooks: имя/события + «Создать» | `addWh()` → AsyncStorage `aso_webhooks` | ConnectorsScreen.tsx:189-193 → :72 |

### 2.8 KanbanScreen, UsageScreen, AgentScreen, AgentSettingsScreen, Onboarding

| Экран | Элемент UI | Действие | Файл:строка |
|---|---|---|---|
| Kanban | Назад | `navigation.goBack()` | KanbanScreen.tsx:82 |
| Kanban | Карточка задачи | `forward(id)` — `todo→doing→done` (`NEXT`) | KanbanScreen.tsx:100-102 → :58 |
| Kanban | × на карточке | `del(id)` | KanbanScreen.tsx:114 → :64 |
| Kanban | Поля title/assignee + «Создать» | `add()` → AsyncStorage `aso_kanban_tasks` | KanbanScreen.tsx:122-126 → :51 |
| Usage | Назад | `navigation.goBack()` | UsageScreen.tsx:34 |
| Usage | — | других интерактивных элементов нет | UsageScreen.tsx:42-78 |
| Agents | Назад | `navigation.goBack()` | AgentScreen.tsx:38 |
| Agents | `DeptRow` «Kanban-доска» | `navigation.navigate('Kanban')` | AgentScreen.tsx:53-61 (`:57`) |
| Agents | `DeptRow` «Использование» | `navigation.navigate('Usage')` | AgentScreen.tsx:58 |
| Agents | `DeptRow` «Субагенты» | `setDept('subagents')` | AgentScreen.tsx:59 |
| Agents | Карточки `AGENTS` (4 шт.) | `navigation.navigate('Kanban')` — все ведут на доску | AgentScreen.tsx:78-80 |
| Agents | «Настройки агента: память, навыки» | `navigation.navigate('AgentSettings')` | AgentScreen.tsx:98-99 |
| AgentSettings | Назад | `navigation.goBack()` | AgentSettingsScreen.tsx:177 |
| AgentSettings | «Очистить память» | `handleClearMemory()` | AgentSettingsScreen.tsx:192 → :65 |
| AgentSettings | Строка навыка | `handleOpenSkill(name)` — показать тело SKILL.md | AgentSettingsScreen.tsx:203 → :110 |
| AgentSettings | Корзина навыка | `handleDeleteSkill(name)` | AgentSettingsScreen.tsx:209 → :95 |
| AgentSettings | «скрыть» у тела навыка | `setSkillBody(null)` | AgentSettingsScreen.tsx:220 |
| AgentSettings | Поля навыка + «Сохранить навык» | `handleSaveSkill()` | AgentSettingsScreen.tsx:255 → :79 |
| AgentSettings | «Запустить куратора (архив старых)» | `runCurator()` + тост | AgentSettingsScreen.tsx:257-265 |
| AgentSettings | Todo: тап по строке | `handleTodoStatus(id, toggle)` | AgentSettingsScreen.tsx:271 → :123 |
| AgentSettings | Todo: × | `handleRemoveTodo(id)` | AgentSettingsScreen.tsx:280 → :129 |
| AgentSettings | Todo: поле + «Добавить» | `handleAddTodo()` | AgentSettingsScreen.tsx:296 → :115 |
| AgentSettings | Todo: «Очистить» | `handleClearTodos()` | AgentSettingsScreen.tsx:299 → :135 |
| AgentSettings | Cron: `Switch` | `handleToggleJob(id, v)` + `notifyCronChange()` | AgentSettingsScreen.tsx:313-315 → :158 |
| AgentSettings | Cron: корзина | `handleRemoveJob(id)` | AgentSettingsScreen.tsx:325 → :164 |
| AgentSettings | Cron: форма + «Создать автозадачу» | `handleAddJob()` | AgentSettingsScreen.tsx:364 → :141 |
| Onboarding | Primary-кнопка слайда | `handlePrimary()`: `next`→`go(cur+1)`, `files`→`openStorageSettings()`/разрешение, `battery`→`openBatterySettings()`, `notifications`→`openNotificationSettings()`, `done`→`AsyncStorage 'aso_onboarding_done'` + `onDone()` | OnboardingScreen.tsx:442 → :501-535 |
| Onboarding | Ghost «Пропустить» | `go(cur + 1)` | OnboardingScreen.tsx:462 → :563 |

### 2.9 Жесты

| Жест | Где | Что делает | Файл:строка |
|---|---|---|---|
| Свайп вниз по хендлу/заголовку шторки | все `Sheet` | тянет панель: `dy>90` или флик (`vy>0.6` и `dy>24`) → закрытие, иначе spring-возврат | Sheet.tsx:115-134 |
| Тап по backdrop шторки | все `Sheet` | `animateClose()` → `onClose()` | Sheet.tsx:175-177 |
| Кнопка «назад» Android | все `Sheet` | `onRequestClose={animateClose}` | Sheet.tsx:170 |
| Долгое нажатие 350 мс на сообщении | `Main` | шторка действий сообщения | ChatScreen.tsx:1470-1472 |
| Долгое нажатие на файле | `VibeProject` | меню файла (открыть/править/переименовать/удалить) | VibeProjectScreen.tsx:440 |
| Горизонтальный свайп между слайдами | Onboarding | **не реализован** (только кнопки) | OnboardingScreen.tsx:484-499 |

## 3. МЁРТВЫЕ МЕСТА

| # | Что | Симптом | Доказательство |
|---|---|---|---|
| 1 | **`StorageSheet` целиком недостижима** (1010 строк UI: проводник, проекты, скиллы, память, todo, cron, коннекторы) | шторка смонтирована в `Main`, но `storageOpen` никогда не ставится в `true` | рендер ChatScreen.tsx:1285-1290; `openStorageSheet` объявлен ChatScreen.tsx:194 и **не вызывается нигде** (grep: единственное вхождение — строка определения) |
| 2 | Внутри `StorageSheet` — раздел `INSTRUCTIONS.md` | ветка `path[0] === 'instructions'` не открывается: `setPath(['instructions'])` нигде нет | StorageSheet.tsx:180; `setPath` вызывается только на `storage/skills/memory/todo/cron/connectors/project-files` (:258, :282, :361) |
| 3 | Пункт «Хранилище» в боковом меню | удалён: в комментарии прямо сказано, что его нет | ChatScreen.tsx:1262-1263 |
| 4 | **Кнопка «Переименовать» проекта** (`Vibe`) | открывает шторку меню, но поля ввода нет; `renameText` уже равен имени → условие всегда false → молча закрывается, ничего не происходит | VibeScreen.tsx:468-483 (условие :473), `setRenameText(item.name)` :269, ни одного `TextField` в этой шторке (:446-488) |
| 5 | **`ToolCard` в чате проекта «висит» в loading** | `onTool` добавляет сообщение без `toolState`, рендер всегда `state='loading'`; `onOpen` не передан → тап не открывает детали | VibeProjectScreen.tsx:149 и :599 |
| 6 | Ветка «Пропустить» в `ThinkingBlock` | кнопка рендерится только при переданном `onSkip`, а `onSkip` не передаётся ни из `ChatScreen`, ни из `VibeProject` | ThinkingBlock.tsx:71-79; вызовы ChatScreen.tsx:1095, :1510, VibeProjectScreen.tsx:590-599 |
| 7 | **Карточки `AGENTS` в разделе «Агенты»** | все 4 (`Agent Swarm`, `Kimi Claw`, `Кодер`, `Терминал`) ведут на `Kanban` — приманки-заглушки | AgentScreen.tsx:15-20 и :80 |
| 8 | **`UsageScreen` — декорация** | `const STATS: [] = []` → суммы всегда 0, таблица всегда в пустом состоянии; экран без единого действия кроме «назад» | UsageScreen.tsx:18, :27-29, :59-61 |
| 9 | **`KanbanScreen` — автономный стор** | задачи в AsyncStorage `aso_kanban_tasks`, движок `src/core/kanban.ts` не импортируется никем; агент к доске отношения не имеет | KanbanScreen.tsx:18-49; grep `core/kanban` = 0 вхождений |
| 10 | **`ConnectorsScreen` — автономный стор** | MCP/webhooks лежат в `aso_mcp_servers` / `aso_webhooks`, движок `src/core/connectors.ts` не используется; «Мессенджеры» — только статус, Discord вечно «скоро»; Telegram-строку нельзя ни подключить, ни отключить | ConnectorsScreen.tsx:21-85, :130-142; grep `core/connectors` = 0 |
| 11 | **Переключатели настроек — декоративные** | `maxTurns`, `approvals`, `compression`, `stt*`, `ttsProvider`, `memoryEnabled`, `redactSecrets`, `delegationMax` пишутся в AsyncStorage, но модули-потребители не подключены | SettingsScreen.tsx:42-50; `core/agentConfig.ts`, `core/voice.ts`, `core/security.ts`, `core/delegation.ts` — 0 импортов во всём проекте |
| 12 | **TTS не реализован вообще** | выбор «Голос ответов (TTS)» ни на что не влияет: в коде нет ни `expo-speech`, ни вызова синтеза | `core/voice.ts` не импортируется; grep по `Speech.speak` вне `core/voice.ts` пуст |
| 13 | **Импорт данных не применяется на устройстве** | после `importBackupFromFile` состояние перезагружается через `globalThis.location.reload()` — в нативном RN `location` нет → данные в UI не перечитаются до перезапуска | SettingsScreen.tsx:205-216 (:.211) |
| 14 | **`/model` в справке, но не в коде** | `/help` обещает `/model — сменить модель (настройки)`, в `switch` такого `case` нет → текст уходит модели как обычное сообщение | ChatScreen.tsx:299 vs :288-356 (default :354) |
| 15 | **Дубликат настроек агента** | «Память → Агент: память, навыки, задачи» и «Делегация → Агент: автозадачи, куратор» ведут на один и тот же `AgentSettingsScreen`; на самом экране нет ни делегации, ни max_turns | SettingsScreen.tsx:468 и :500; AgentSettingsScreen.tsx:186-370 |
| 16 | **Дубликат раздела «Мои модели»** | `dept==='mymodels'` рендерит тот же `FlatList data={customs}`, что и `myproviders` — отличается только заголовком | ProvidersScreen.tsx:112-121, :191-194 |
| 17 | **Удаление без подтверждения** | провайдер и модель удаляются по одному тапу, без Alert (в отличие от сессий/проектов) | ProvidersScreen.tsx:151, :177 |
| 18 | **Индикатор фоновых не видит cron** | `BgIndicator count={bgTasks.length}` — cron-джобы добавляются только внутри открытого листа, поэтому при одном cron счётчик = 0 и шторка недоступна | ChatScreen.tsx:1032 / :85-89; BgTasksSheet.tsx:52-58 |
| 19 | **`BgTasksSheet.onOpen` — пустышка** | «глаз» только закрывает лист, никакого перехода к задаче | ChatScreen.tsx:1068 |
| 20 | Чат проекта беднее основного | в `VibeProject` нет копирования/редактирования/удаления сообщений, нет вложений, нет слэш-команд | VibeProjectScreen.tsx:119-176, :586-600 |
| 21 | Мёртвые файлы компонентов | `src/components/Drawer.tsx` (старый drawer, 0 импортов), `src/components/icons/{Icon.tsx,iconPaths.ts,index.ts}` (0), `design-system/components/{TextArea,Skeleton,GlassBackdrop}.tsx` (0), в `components/ui.tsx` не используются `BottomSheet`, `Card`, `GroupLabel`, `CapBadge`, `useTypo` | grep по импортам |
| 22 | Мёртвые движки в `src/core` | `agentConfig`, `background`, `connectors`, `crypto`, `delegation`, `display`, `kanban`, `security`, `sessions`, `toolsets`, `url`, `usage`, `voice` — 0 импортов | проверено по каждому модулю |
| 23 | Ручное создание навыка в `AgentSettings` доступно всегда | форма создания висит под телом открытого навыка; при открытом `skillBody` кнопка «Сохранить навык» всё равно создаёт **новый** навык из полей, что легко принять за «сохранить открытый» | AgentSettingsScreen.tsx:216-255 |
| 24 | `Vibe → Файлы агента` — только чтение | ни открыть, ни скачать, ни удалить файл нельзя | VibeScreen.tsx:280-304 |

## 4. КОМПОНЕНТЫ-ШТОРКИ И ПАНЕЛИ

| Компонент | Файл | Что делает | Откуда открывается |
|---|---|---|---|
| `Sheet` (базовый) | `src/design-system/components/Sheet.tsx` | Модалка снизу на `react-native Modal`: хендл-зона, drag-закрытие (>90 px / флик), backdrop, `KeyboardAvoidingView`, `heightPct` + `auto/autoMaxPct` | Базис для всех шторок ниже |
| `DrawerLineArt` | `src/components/DrawerLineArt.tsx` | Боковое меню: перо-лого, «Новый чат», выбор модели, «Провайдеры», 6 маршрутов (`Agents`, `Vibe`, `Connectors`, `Kanban`, `Usage`, `Settings`), поиск, список сессий с rename/delete | `Main` — бургер, `ChatScreen.tsx:1264-1281` (визибл `drawerOpen` :1028) |
| `StorageSheet` | `src/components/kimi/StorageSheet.tsx` (1010 стр.) | Проводник агента: корень (`Хранилище`, `Скиллы`, `Память`, `Задачи`, `Автозадачи`, `Коннекторы`) → подэкраны: выбор проекта, файлы проекта (`ProjectFiles`: создание папки/файла, правка, удаление), скиллы (`Skills`, создание/правка/удаление + куратор), память (`Очистить память`, `Обновить`), todo, cron, коннекторы | **Ниоткуда** — см. мёртвые места №1 |
| `BgTasksSheet` + `BgIndicator` | `src/components/BgTasksSheet.tsx` | Лист фоновых процессов: строки `runtime`/`stream`/`cron`/`delegation`, кнопки «глаз» (`onOpen`) и «стоп» (`onStop`). `BgIndicator` — тихий чип «точка + число», рендерится только при `count>0` | `Main` — чип в шапке, `ChatScreen.tsx:1032`; внутри cron подгружается сам (`loadJobs`, BgTasksSheet.tsx:52-58) |
| `ThinkingBlock` | `src/components/kimi/ThinkingBlock.tsx` | Строка «Думаю…» с пульсирующей лампочкой; после завершения — кликабельная («Думаю» + шеврон) и открывает шторку с `reasoning_content`; режим `bare` для цепочки | `Main` (ChatScreen.tsx:1095 и :1510) и `VibeProject` (:590) |
| `ToolCard` | `src/components/kimi/ToolCard.tsx` | Карточка инструмента: иконка, `essence(tool)` (терминал/файл/поиск), состояние `loading/done/error`, тап → шторка с командой и выводом | `Main` (:1104, :1449), `VibeProject` (:599, всегда `loading`) |
| Шторка «Сообщение/Ответ» | `Main`, inline `Sheet` | Действия с сообщением: «Повторить запрос» (только ответ), «Копировать», «Поделиться», «Удалить сообщение» | Долгое нажатие на пузыре (`ChatScreen.tsx:1293`) |
| Шторка «Думаю» / «Ход выполнения» | `Main`, inline | Моно-текст: `tool + toolOutput` либо `thinking`; кнопок нет | `ThinkingBlock`/`ToolCard` (`ChatScreen.tsx:1307`) |
| Шторка «Изменить сообщение» | `Main`, inline | Многострочный `Input`, «Отмена»/«Отправить» (`confirmEdit`) | Иконка edit у своего сообщения (`ChatScreen.tsx:1326`) |
| Шторка «Прикрепить» | `Main`, inline | Три квадратных кнопки: «Фото», «Камера», «Файл» | ＋ в капсуле (`ChatScreen.tsx:1353`) |
| Шторка «Переименовать сессию» | `Main`, inline | `Input` + «Отмена»/«Сохранить», Enter = сохранить | Карандаш в drawer (`ChatScreen.tsx:1383`) |
| Шторка «Удалить сессию?» | `Main`, inline | Текст-предупреждение + «Отмена»/«Удалить» | Корзина в drawer (`ChatScreen.tsx:1408`) |
| `Sheet` создания проекта | `Vibe`, inline | `TextField` имя + `TextField` описание + «Создать» | ＋ в шапке (`VibeScreen.tsx:437`) |
| `Sheet` меню проекта | `Vibe`, inline | «Экспорт», «Переименовать», «Удалить» | `IconButton more` (`VibeScreen.tsx:446`) |
| Шесть шторок `VibeProject` | inline | «Файл» (копировать/экспорт/править), «Правка», «Новый файл», «Новая папка», меню файла (открыть/править/переименовать/удалить), «Переименовать», «Удалить?» | `VibeProjectScreen.tsx:454, :468, :484, :512, :540, :556, :575` |
| `Sheet` формы провайдера / модели | `Providers`, inline | Провайдер: Название, Endpoint, API-ключ, «Сохранить». Модель: имя, temperature, system prompt, «Проверить», «Сохранить» | `ProvidersScreen.tsx:257`, `:337` |
| `Dept*` (`DeptRow`, `DeptDivider`, `DeptBack`, `DeptIcon`) | `src/components/Dept.tsx` | Универсальная строка-«отдел» со стрелкой, разделитель, «назад», 3 сета иконок (`ICON_SET = 'C'`) | `Vibe`, `Settings`, `Providers`, `Connectors`, `Agents` |
| `BottomSheet` (в `components/ui.tsx`) | `src/components/ui.tsx:167` | Старая шторка-дубль `Sheet` | **Не используется** (мёртвый) |
| `Drawer` | `src/components/Drawer.tsx` | Старое боковое меню (перо + пункты «Агент», «Настройки» и т. д.) | **Не используется** (мёртвый) |

### Темы/токены (для редизайна)

| Файл | Роль |
|---|---|
| `src/theme/tokens.ts` | `themes { light, dark, system }`, `fonts` (MiSansLatin, GeistMono, PixelifySans), ключи `bg/surface/surface2/text/dim/mute/border/accent/accentHi/accentDim/onAccent/userBubble/userText/codeBg/codeText/scrim/ripple/danger/ok/warn/nameColor` |
| `src/design-system/tokens.ts` | `radii` (`md/xl`), базовая палитра дизайн-системы |
| `src/design-system/components/*` | `AppIcon` (200+ иконок), `Button`, `IconButton`, `Input`, `Chip`, `Glass`/`GlassPressable`, `EmptyState`, `Toast` (`showToast`, `ToastHost`) |
| `src/components/Markdown.tsx` | `renderMarkdown` — заголовки, списки, цитаты, ссылки (`Linking.openURL`), инлайн-код, `CodeBlock` с кнопками `wrap`/`copy` (:139-154) |
