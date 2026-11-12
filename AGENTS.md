# AGENTS.md — VK Doll Community

Electron-приложение для Windows: «Мои посты» — набор постов ВКонтакте, которые пользователь добавляет вручную по ссылке, и кто их лайкает. Источников (сообществ, стен) больше нет: программа не листает стены, а проверяет только добавленные посты. Чистый HTML/CSS/JS, без фреймворков, сборщиков и БД — данные в JSON-файлах. Интерфейс и тексты — на русском, пишем в том же стиле (простыми словами для неподготовленного пользователя).

Подробности для людей — в [README.md](README.md). Здесь — карта для быстрой навигации.

## Где что

| Задача | Куда смотреть |
|---|---|
| IPC-обработчики (всё, что вызывает интерфейс) | `desktop/main.js`, функция `registerIpc()`; обёртка `h(channel, fn)` логирует ошибки и возвращает `{ok, data \| error}` |
| Мост интерфейс ↔ main | `desktop/preload.js` (`window.api.*` → канал IPC) |
| «Добавить пост» (ссылка + название) | диалог `openAddPost()` в `src/js/library.js` → IPC `post:add` → `addPost()` в `desktop/posts.js`; затем `sync:start` с `{ postIds: [id] }` |
| Название поста (`post.title`) | задаётся при добавлении, меняется в редакторе карточки (`post.js`) → IPC `post:set-title` |
| Разбор ссылок на пост (`wall-123_456`, `?w=wall…`) | `parsePostInput()` в `desktop/vk.js` |
| Получение поста из VK | `PostFetcher` в `desktop/wallfind.js`: `wall.getById`, а при коде 1051 (ключ VK ID) — поиск на стене через `wall.get` двоичным поиском по offset; место запоминается в `post.wall_offset` |
| Вызовы VK API, лимит частоты, повторы, перевод ошибок | `desktop/vk.js` (`VkClient`, `classify()`); версия API — `API_VERSION` |
| Вход VK ID (OAuth 2.1 + PKCE), продление ключа | `desktop/vkid.js`; окно входа и хранение сессии — `desktop/main.js` (`saveSession`/`loadSession`/`refreshSession`) |
| «Обновить данные»: `wall.getById` только по добавленным постам → лайки → профили → фото | `desktop/sync.js` (`SyncEngine.run({ postIds })`) |
| Списки лайков со страницы «Оценили» на m.vk.ru (когда `likes.getList` даёт 1051) | `desktop/weblikes.js` (`WebLikes`, `likersToIds`); вход на vk.com — `vkWebLoginWindow()` в `desktop/main.js`, куки в разделе `persist:vkweb`; IPC `vkweb:status/login/logout` |
| Модель публикации: оригинал VK vs ручные правки | `desktop/model.js` |
| JSON-хранилище, атомарная запись, `.prev`, миграции | `desktop/storage.js` |
| Экраны интерфейса | `src/js/` — `app.js` (каркас/навигация), `library.js` («Мои посты»), `post.js`, `stats.js`, `people.js`, `trash.js`, `settings.js` (в т.ч. параметры обновления), `tour.js` (обучение), `state.js`, `util.js` |
| Окна и боковые панели (слои) | `modal()` / `drawer()` в `src/js/util.js`: новое окно всегда поверх открытых (`pushLayer`), Esc закрывает только верхнее, у панели поверх другой — кнопка «Назад» |
| Стили / разметка | `src/css/style.css`, `src/index.html` |
| Установщик | `package.json` → `build`, `build/installer.nsh` |

## Команды

```bash
npm test            # юнит-тесты; VK подменяется фейковым fetch в test/run-tests.js
npm run test:ui     # проверка интерфейса (test/run-ui-check.js)
npm start           # запуск из исходников
npm run dist        # установщик в dist/
```

Демо-данные без VK: `node test/make-demo.js <папка> 150`, затем запуск с `VKD_TEST_ROOT=<папка>`.

## Данные и логи на машине пользователя

- Библиотека: `%APPDATA%\VK Doll Community\` (`data/*.json`, `backups/`, `logs/app.log`).
- Служебное и зашифрованный ключ VK (DPAPI, `secure/vk-token.bin`): `%LOCALAPPDATA%\VK Doll Community\`.
- **Подвох:** Claude desktop — MSIX-приложение, и процессы, запущенные из него, видят виртуализированный `%APPDATA%` (`...\Packages\Claude_*\LocalCache\Roaming\...`), где может лежать старая копия лога. Настоящий лог установленной программы читать через `\\localhost\c$\Users\<user>\AppData\Roaming\VK Doll Community\logs\app.log`.
- Ключ VK пользователя не расшифровывать и не использовать для своих проверок без явного разрешения.

## Известные особенности VK

- Ключи VK ID могут не поддерживать часть методов: VK отвечает «Method is not available for this profile type» (код 1051 → `VkError` с кодом `unsupported`).
- `likes.getList` у приложений VK ID возвращает код 1051 и с ключом пользователя, и с сервисным ключом. `sync.js` перебирает способы: API → сервисный ключ → страница vk.com (`weblikes.js`).
- Страница «Оценили»: POST `_ajax=1` + `X-Requested-With` → JSON с `html`, по 50 человек на страницу (`offset`). Без входа — только первые ~350, дальше VK повторяет одну страницу; тогда список помечается неполным (`likers_complete: false`) и старые лайки не удаляются (`applyLikers(..., { partial: true })`). Скрытые лайки — VK отвечает `{"location": "id…"}` без `html`.
- Пробовали читать посты и лайки только со страниц сайта (скрытое окно, без VK API) — работало нестабильно, пользователь попросил вернуть VK API. Не возвращаться к этому без запроса.
- Ошибки VK типа `api` содержат имя метода и код (`… (method, код N)`) — смотрите их в `app.log`.
- Лимит ~3 запроса/с соблюдает очередь в `VkClient`; не вызывайте `fetch` к API в обход неё.

## Правила

- Новый вызов VK → добавить ветку в фейковый `fetch` в `test/run-tests.js`.
- Новый файл в `desktop/` → добавить его в `build.files` в `package.json`, иначе установленная программа не запустится.
- В старых данных могут остаться `settings.sources` и `post.source_id` — их не используют (только `ownerName()` берёт оттуда имя для старых постов).
- Запись данных — только через `store` (`store.save` / `store.writeNow`), не напрямую через `fs`.
- Ручные правки пользователя имеют приоритет над данными VK — не перезаписывать их при синхронизации (см. `model.js`).
