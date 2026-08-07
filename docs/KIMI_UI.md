# Kimi UI — эталон редизайна Aso-z (вытащен из реального APK v2.29)

Всё ниже — ФАКТЫ из `/tmp/kimi_apk` (base.apk от юзера), не догадки.

## 1. Философия

- Всё происходит в ОДНОМ чате. Инструменты, поиск, терминал, файлы — не экраны,
  а сообщения/карточки в ленте.
- Процесс виден: каждое действие агента = карточка с иконкой + статус
  (`Используется X` → `Использовать X` / `Не удалось использовать X`).
- Раздумья — отдельный блок `Обдумывание…` с анимацией и кнопкой «Пропустить».
- Код — отдельные код-блоки с шапкой: язык + копировать + word wrap.
- Сложные объекты (диаграммы mermaid, майндмапы markmap, PDF) — через WebView.
- Проекты: лимит по плану, архивация, восстановление.

## 2. Токены (widget_foundation.css, официальные kimi-widget)

### Light
| Токен | Значение |
|---|---|
| bg primary / secondary | `#ffffff` / `#f5f5f5` |
| text primary / secondary / tertiary | rgba(0,0,0,.9) / .6 / .45 |
| accent KMBlue | `#1783ff` |
| red / green / yellow / orange / purple | `#ff3849` / `#16c456` / `#ffd230` / `#ff9500` / `#985ffb` |
| border divider | rgba(0,0,0,.13) |

### Dark
| Токен | Значение |
|---|---|
| bg primary / secondary | `#121212` / `#1f1f1f` |
| text primary / secondary | rgba(255,255,255,.84) / .56 |
| accent KMBlue | `#1a88ff` |
| green / purple / chart | `#32ff7d` / `#a16bff` / `#dcdcaa` / `#ce9178` |
| mono hint bg | `#292929` |
| border divider | rgba(255,255,255,.12) |

### Typography
- body B1 16/26, secondary 14/22, code 14/22, H1 20/32, H2 18/28
- sans: Inter / SF Pro; mono: SF Mono / Fira Code; фирменный GeistMono

## 3. Статусы раздумий (strings RU/EN)

- `thinking` = «Обдумывание…» / Thinking…
- `thinking_in_progress` = «Обдумывание»
- `thinking_done` = «Обдумывание завершено»
- `thinking_cancelled` = «Обдумывание остановлено»
- `kimi_is_thinking` = «Kimi думает…»
- `MESSAGE_LABEL_THINKING_SKIP` — кнопка «Пропустить» раздумья
- Модели: `reasoningEffort` NONE/LOW/MEDIUM/HIGH/MAX/XHIGH — выбор уровня
- Анимации: `k1loading.riv`, `icon-k2thinking.riv`, `icon-lightbulb-loading.riv`

## 4. Инструменты (okc_tool_*) — паттерн карточки

Каждый инструмент имеет 3 состояния: loading/done/error, формат «Используется X».

| Инструмент | loading | done | error |
|---|---|---|---|
| Terminal (Командная строка) | Выполнение командной строки | Выполнить командную строку | Не удалось выполнить |
| iPython | Выполняется код Python | Выполнить код Python | Не удалось выполнить |
| Web search | Поиск веб-страниц | Искать веб-страницы | Не удалось выполнить поиск |
| Read file | Чтение | Читать | Не удалось прочитать файл |
| Write file | Создание файла | Файл создан | Не удалось создать файл |
| Edit file | Редактирование | — | Не удалось изменить файл |
| Todo read/write | Чтение/Запись дела | Прочитать/Записать дело | Не удалось |
| Ask user | Запрос | Собранная информация | — |
| Browser find | — | Поиск | — |
| Common (fallback) | Используется %s | Использовать %s | Не удалось использовать %s |

- `okc_tool_name_shell` = «Командная строка», `okc_tool_name_ipython` = «iPython»,
  `okc_tool_name_web_search` = «Веб-поиск», `okc_tool_name_default` = «Компьютер Kimi»
- `okc_tool_ask_user_button_*`: Далее/Назад/Отправить/Пропустить
- Поиск: `numbs_for_search_and_read` = «Найдено ключевых слов: N; прочитано веб-страниц: M»
- Анимации: `tool-web.riv`, `tool-todo.riv`, `tool-mcp.riv`, `tool-locate.riv`,
  `tool-image.riv`, `tool-doc.riv`, `tool-data.riv`, `tool-sounds.riv`, `tool-ppt.riv`,
  `tool-memory.riv`, `icon-code.riv`, `icon-browser.riv`

## 5. Код

- Подсветка: `prism4j` (порт Prism.js в Kotlin, нативный Compose)
- Палитра подсветки — как VS Code Dark+ (#dcdcaa, #ce9178, #569cd6, #1a88ff, #ff4756)
- `code_is_outputting` = «Код генерируется. Пожалуйста, подождите»
- `code_soft_wrapped` / `code_cancel_soft_wrapped` — переключатель переноса строк
- Шрифт: GeistMono / SF Mono / Fira Code

## 6. WebView-рендер (сложный контент)

- `chunks/mermaid.esm.min` — диаграммы (flow/arch/gantt)
- `npm/markmap-*` + `npm/d3-6.7.0` — майндмапы
- pdf.html — PDF
- mobile.v2.29.2.html — капча (не рендер)

## 7. Проекты (RU)

- `project_manage_desc` = «Текущий план %s позволяет сохранить %d проектов.
  Выберите проекты, которые нужно сохранить; остальные будут архивированы
  и могут быть восстановлены после обновления.»
- `project_count_limit_desc`, `project_file_see_more` = «Посмотреть ещё %d файл»
- Паттерн: выбрать проект → агент знает его контекст (имя, описание, файлы).

## 8. Agent Swarm (RU)

- «Набор Agent», «Задача ожидает» / «Задача выполнена», «Рабочий день окончен»,
- «Сообщение от Agent», «Отправка сообщения Agent», «Ожидание сообщения от Agent»

## 9. Что это значит для Aso-z (RN/Expo)

1. Тема: KMBlue `#1783ff`/`#1a88ff`, тёмный `#121212`/`#1f1f1f`, светлый `#fff`/`#f5f5f5`.
2. Раздумья: стримить `reasoning_content` в отдельный блок с анимацией +
   кнопка «Пропустить», статусы done/cancelled.
3. Инструменты: карточки «Иконка + Используется X» → «Использовать X» с анимацией
   (RN Animated вместо .riv — лёгкий эквивалент).
4. Код: тёмный фон всегда, шапка (язык + копировать + wrap), моношрифт,
   подсветка по палитре VS Code Dark+.
5. Один чат: селектор проекта сверху; выбран проект → системный промпт с
   описанием и деревом файлов; FILE-блоки пишутся в проект; файлы/терминал
   доступны иконками в шапке.
6. Настройки: чистые секции (Профиль/Аккаунт/Настройки/Данные/О приложении),
   карточки с тонкими разделителями, синий акцент.
