# Pasha VK Music Backend — PoC

Схема:

`PWA (GitHub Pages) → Node backend → @toil/vk-audio → VK Web`

Цель этого PoC — пока НЕ делать полноценный плеер, а проверить самое важное:
**можем ли мы через твою обычную VK web-сессию получить музыкальные секции.**

---

## 0. Что нужно

На Mac:

- Node.js 20+ (лучше 22)
- npm
- браузер, где ты уже залогинен во VK

Docker пока НЕ обязателен. Он лежит в проекте на будущее.

---

## 1. Распакуй архив

Например:

```bash
cd ~/Downloads/pasha_vk_music_backend
```

---

## 2. Установи зависимости

```bash
npm install
```

---

## 3. Создай `.env`

```bash
cp .env.example .env
```

Открой `.env`.

Там нужно заполнить:

```env
VK_COOKIE_P=...
VK_COOKIE_REMIXSID=...
API_KEY=...
```

### Где взять cookies

Используй браузер, где ты уже вошёл во VK.

Один из способов:

1. Открой `vk.com` / `vk.ru`.
2. DevTools → Network.
3. Обнови страницу или открой раздел музыки.
4. Выбери запрос к VK.
5. В Request Headers найди `Cookie`.
6. Найди значения cookies с именами `p` и `remixsid`.
7. Скопируй только их значения в `.env`.

**Важно:**
`remixsid` — чувствительный секрет активной сессии.
Не отправляй его в чат, не коммить в GitHub и не клади во frontend.

`API_KEY` защищает публичный backend. PWA хранит его только локально на устройстве
и отправляет как `Authorization: Bearer ...`. Не записывай ключ в файлы frontend.

---

## 4. Запусти backend

```bash
npm run dev
```

Должно появиться:

```text
VK Music backend: http://localhost:8787
```

---

## 5. Сначала проверь health

Открой:

```text
http://localhost:8787/api/health
```

Нормальный ответ:

```json
{
  "hasCookieP": true,
  "hasRemixSid": true
}
```

Если там `false`, значит `.env` заполнен или прочитан неправильно.

---

## 6. Главный тест

Открой:

```text
http://localhost:8787/api/sections
```

Если всё получилось, увидишь:

```json
{
  "ok": true,
  "result": ...
}
```

В `result` должны приехать данные от VK Music.

Это наша первая точка **GO / NO-GO**.

Дополнительные PoC endpoints:

- `GET /api/sections/:sectionId` — треки выбранной музыкальной секции;
- `GET /api/first-track` — первый трек из основной секции со свежим HLS URL в `result.track.fileUrl`.
- `GET /api/tracks/:ownerId/:audioId/recommendations` — похожие треки для создания микса через внутренний VK Audio API.

`fileUrl` временный: frontend должен получать его у backend непосредственно перед воспроизведением.

Если sections приходят — проект технически становится намного интереснее.
Тогда следующий этап:

1. найти в ответе реальные треки;
2. получить playback URL;
3. сделать endpoint `/api/track/...`;
4. подключить его к PWA;
5. попробовать воспроизведение на iPhone.

---

# Docker — позже

Если локальный Node заработал, можно проверить и Docker.

Сначала:

```bash
docker compose up --build
```

Потом снова:

```text
http://localhost:8787/api/health
http://localhost:8787/api/sections
```

Docker ничего не добавляет к работе с VK — это просто упаковка backend.

---

# Как потом соединить с твоей PWA

Сейчас PWA живёт на:

```text
https://pavelmartynovlive-bit.github.io/pasha-music/
```

GitHub Pages может хостить только frontend.
Node backend понадобится отдельно выложить на сервис, который умеет запускать Node/Docker.

После этого PWA будет делать:

```js
fetch("https://АДРЕС-БЭКЕНДА/api/sections")
```

А backend уже сам общается с VK.

**VK cookies никогда не уходят в PWA.**

---

# Безопасность

Это неофициальный внутренний VK Audio API.

Поэтому:

- API может внезапно измениться;
- VK-сессия может протухнуть;
- проект лучше считать личным экспериментом;
- не клади `p`, `remixsid`, access tokens или пароль VK в публичный репозиторий;
- не используй пароль VK внутри приложения.

`.gitignore` уже исключает `.env`.

---

# Если `/api/sections` упал

Пришли в ChatGPT:

1. HTTP status;
2. JSON ошибки;
3. вывод Terminal.

Но **вырежи любые cookies/tokens**, если они случайно попали в вывод.
