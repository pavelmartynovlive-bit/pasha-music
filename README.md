# Pasha Music — GitHub Pages version

Эта версия рассчитана на публикацию в project site GitHub Pages:

`https://USERNAME.github.io/REPOSITORY/`

Все ссылки внутри PWA относительные, поэтому имя репозитория может быть любым.

## Как опубликовать

1. Создай новый публичный репозиторий на GitHub, например `pasha-music`.
2. Распакуй ZIP и загрузи **содержимое папки**, а не сам ZIP.
3. В репозитории открой:
   `Settings → Pages`
4. В `Build and deployment` выбери:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Сохрани.
6. GitHub Pages выдаст адрес примерно:
   `https://USERNAME.github.io/pasha-music/`

## Как поставить на iPhone

1. Открой этот URL в Safari.
2. Нажми Share.
3. Выбери `Add to Home Screen` / `На экран «Домой»`.
4. Запусти новую иконку с домашнего экрана.

PWA должна открыться сразу на экране `/music/` и работать как standalone-приложение.

## Подключение backend

Опубликованная PWA автоматически использует backend:

`https://pasha-music.132-243-23-229.sslip.io`

При первом запуске остаётся указать только:

- персональный API-ключ.

Если в браузере был сохранён прежний адрес Render, приложение автоматически
заменит его на адрес VPS и сохранит существующий API-ключ.

Настройки хранятся только в `localStorage` браузера. VK cookies во frontend не
передаются и в репозиторий не записываются.

Backend должен разрешать CORS для:

`https://pavelmartynovlive-bit.github.io`

## Backend на VPS

В папке `backend/` находится Node.js API без секретов. На VPS он работает как
systemd-сервис за Nginx и доступен только по HTTPS. Файлы для установки находятся
в `backend/deploy/`.

Render пока можно оставить как резервную копию, но PWA к нему больше не
подключается и GitHub Actions не посылает keep-alive запросы.

`.env`, cookies и API-ключ исключены из Git и не должны попадать в GitHub.

## Проверки плеера

Сценарии прерывания микрофоном, восстановления позиции и системных команд
описаны в [tests/README.md](tests/README.md). Тесты выполняются в WebKit и Chromium.
