# Иконки Aso-z — единый SVG-набор

Минималистичные контурные иконки, 20 шт. Никаких эмодзи в UI.

## Спецификация стиля

- Сетка **24×24**, `viewBox="0 0 24 24"`
- Обводка **stroke 1.5**, круглые концы и стыки (`round`)
- Без заливки (`fill="none"`), цвет — `currentColor` (наследует `color`)
- Исключение: `stop` — залитый скруглённый квадрат (`fill="currentColor"`, без обводки)
- Контент в пределах ~3.5…20.5 (оптические отступы)
- Тёмная тема Kimi: иконки красятся токенами (`theme.dim`, `theme.mute`,
  `theme.accentHi`), фон `#0d0d0d`, акцент `#1a88ff`

## Файлы

| Что | Где |
|---|---|
| Источник правды (добавлять иконки — сюда) | `scripts/generate-icons.py` → `python3 scripts/generate-icons.py` |
| Сырые SVG (веб/доки/Figma) | `assets/icons/*.svg` |
| Данные путей для RN | `src/components/icons/iconPaths.ts` (автогенерация, не править) |
| RN-компонент | `src/components/icons/Icon.tsx` |
| Баррель | `src/components/icons/index.ts` |

Набор: `menu`, `new-session`, `model`, `config`, `attach`, `mic`, `send`,
`stop`, `search`, `settings`, `close`, `chevron-down`, `chevron-right`,
`copy`, `share`, `edit`, `trash`, `check`, `folder`, `image`.

## Подключение в RN

```bash
npx expo install react-native-svg
```

```tsx
import { Icon } from "../components/icons";
import { useApp } from "../store/AppStore";

const { theme } = useApp();

// кнопка отправки
<Icon name="send" size={22} color={theme.accent} />
// микрофон в поле ввода
<Icon name="mic" size={20} color={theme.dim} />
// стоп во время стриминга
<Icon name="stop" size={18} color="#fff" />
```

С `IconButton` (дизайн-система) — прокинуть как children вместо `name`:

```tsx
// было: <IconButton name="add" ... />  (MaterialIcons)
// стало:
<Pressable onPress={...} accessibilityLabel="Прикрепить" ...>
  <Icon name="attach" size={22} color={theme.dim} />
</Pressable>
```

## Замены: эмодзи/символы → иконки

| Было (где) | Стало |
|---|---|
| `🚀` — `OnboardingScreen.tsx:289` («Погнали») | убрать эмодзи, рядом `check` `#16c456` |
| `"✓ "` — `ProvidersScreen.tsx:309` | `check`, `theme.ok` |
| `"✕ "` — `ProvidersScreen.tsx:309` | `close`, `theme.danger` |
| `"✕"` — `StorageSheet.tsx:877, 904` | `close`, `theme.mute` |

## Замены: MaterialIcons → Icon (по желанию, полная миграция)

| MaterialIcons (где) | Icon |
|---|---|
| `add` — прикрепить (`ChatScreen:1138`) | `attach` |
| `arrow-upward` — отправка (`ChatScreen:1179`) | `send` |
| `stop` — стоп (`ChatScreen:1170`) | `stop` |
| `mic` — микрофон (`ChatScreen:1186`) | `mic` |
| `keyboard-arrow-down`, `expand-more` — селекторы | `chevron-down` |
| `chevron-right` — раскрытие строк | `chevron-right` |
| `close` — закрыть чипы/превью | `close` |
| `content-copy` — копировать | `copy` |
| `share` — поделиться | `share` |
| `edit` — редактировать | `edit` |
| `delete-outline`, `delete-sweep` — удалить | `trash` |
| `folder`, `folder-open` — файлы/онбординг | `folder` |
| `photo-library`, `photo-camera` — вложения | `image` |
| `smart-toy` — модель (`ProvidersScreen`) | `model` |
| `settings` — настройки (`OnboardingScreen:416`) | `settings` |
| `check` — готово (`OnboardingScreen:378`) | `check` |

Примечание: `fileIconName()` в `ChatScreen:1405` маппит типы файлов на
MaterialIcons — соответствующие ветки заменить на `folder`/`image`/`copy`.
