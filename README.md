# Aso-z Mobile

Нативное мобильное приложение для **Aso** — AI-ассистента (прямой канал к провайдерам, без нашего сервера в цепочке LLM-запросов).

## Архитектура

```
Устройство ──(напрямую)──► внешние провайдеры
                ▲
                │ никакого нашего сервера в LLM-цепочке
                │
                └── конфиг провайдеров зашифрован в src/config/encrypted.ts
                    (в бандле нет ни одного открытого имени — grep пуст)
```

- **Чат**: SSE-стриминг напрямую к провайдеру (`src/core/gateway.ts`), reasoning скрыт (только чистый ответ).
- **Модели**: 6 системных (Aso Math/Code/Super/Aso/Aso Ultra/Aso Multi) из зашифрованного конфига.
- **Сессии**: локально на устройстве (AsyncStorage).
- **Vibe Coding**: проекты/файлы/терминал — на нашем backend (workspace живёт на сервере), LLM-запросы агента тоже идут к провайдерам.
- **Синхронизация с Telegram**: единственное обращение к нашему серверу — ввод @username → бот шлёт подтверждение в личку → JWT.

## Быстрый старт

```bash
npm install
npx expo start          # Expo Go: отсканируй QR телефоном
npx expo start --web    # браузер (CORS-прокси для dev, см. ниже)
```

Для нативного запуска на телефоне: установи **Expo Go**, отсканируй QR. Прямой канал работает без CORS.

## Сборка APK

```bash
npx eas build --platform android --profile preview   # облачная сборка (free tier)
# или локально, если есть Android SDK:
npx expo run:android
```

## Секреты / обфускация

- `src/config/encrypted.ts` — конфиг провайдеров (URL, модели) зашифрован; base64-строки, ключ собирается из фрагментов.
- `src/core/crypto.ts` — ключ собирается из фрагментов (не лежит строкой), XOR-маска.
- **Проверено**: в production-бандле (`npx expo export`) отсутствуют строки с именами/URL провайдеров.

> Честное предупреждение: обфускация замедляет анализ, но упорный реверсер с доступом к рантайму может восстановить URL. Это уровень «шарящий программист не поймёт сходу», не криптозащита.

## Web-режим (только dev)

Браузер блокирует CORS к провайдерам, поэтому web-версия ходит через `/api/mobile/gw` нашего backend (только для отладки UI). В нативной сборке этот путь не используется.

## Backend (только sync + vibe)

```bash
cd ~/projects/Aso-z
MOBILE_DEV=1 .venv/bin/python -m uvicorn --app-dir tma/backend --port 8000 main:app
```

Эндпоинты: `/api/mobile/sync-request`, `/sync-status`, `/profile`, `/vibe/*`, `/gw` (web-dev).

## Структура

```
src/
├── config/encrypted.ts   # зашифрованный конфиг провайдеров
├── core/
│   ├── crypto.ts         # дешифровка (ключ из фрагментов)
│   ├── gateway.ts        # ПРЯМОЙ канал: SSE-стриминг к провайдерам
│   ├── sync.ts           # синхронизация с ТГ (разовый обмен)
│   └── env.ts            # адрес нашего API (для sync/vibe)
├── screens/              # Chat, Vibe, VibeProject, Settings
├── components/           # ui, Markdown
├── store/AppStore.tsx    # глобальное состояние (тема, сессии, токен)
├── theme/tokens.ts       # тёмная (Amber Night) / светлая (Paper)
└── i18n/                 # RU/EN
```
