/* ==========================================================================
   NaebBet — Service Worker (офлайн-кэш, стратегия cache-first)
   --------------------------------------------------------------------------
   КАК ОБНОВЛЯТЬ ВЕРСИЮ КЭША:
   1. После ЛЮБОГО изменения файлов проекта (js, css, html, manifest.json)
      увеличьте значение CACHE_VERSION ниже (например 'v1' -> 'v2').
   2. Если добавили или удалили файл — отредактируйте массив CACHE_FILES.
   3. Задеплойте. При следующем открытии приложения браузер увидит, что sw.js
      изменился, установит новый воркер и создаст новый кэш
      "naebbet-<версия>"; при активации старые кэши удалятся автоматически.
   4. Пока версию не поменяли, пользователи будут видеть СТАРЫЕ файлы
      из кэша (это особенность cache-first).
   Данные игрока (localStorage, ключи "nb_*") при обновлении кэша
   НЕ затрагиваются.
   ========================================================================== */
'use strict';

// Версия кэша — менять при каждом релизе (см. инструкцию выше)
const CACHE_VERSION = 'v1';

// Префикс нужен, чтобы удалять только свои старые кэши
const CACHE_PREFIX = 'naebbet-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Страница, которую отдаём при навигации, если сети нет и запроса нет в кэше
const FALLBACK_PAGE = './index.html';

// Список ВСЕХ файлов проекта для офлайн-работы.
// Пути относительные от расположения sw.js. Подправьте под реальную структуру.
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',

  // Стили
  './css/style.css',

  // Ядро
  './js/core/events.js',
  './js/core/storage.js',
  './js/core/rng.js',
  './js/core/audio.js',
  './js/core/ui.js',
  './js/core/wallet.js',
  './js/core/stats.js',
  './js/core/levels.js',
  './js/core/achievements.js',
  './js/core/rules.js',
  './js/core/router.js',
  './js/core/games.js',

  // Игры
  './js/games/slots.js',
  './js/games/roulette.js',
  './js/games/blackjack.js',
  './js/games/dice.js',
  './js/games/coinflip.js',
  './js/games/crash.js',
  './js/games/mines.js',
  './js/games/poker.js',

  // Экраны и запуск приложения
  './js/screens/lobby.js',
  './js/screens/profile.js',
  './js/screens/stats.js',
  './js/screens/settings.js',
  './js/app.js'
];

// --------------------------------------------------------------------------
// install: предзагрузка всех файлов в кэш
// --------------------------------------------------------------------------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Грузим файлы по одному: если какого-то файла из списка нет на сервере,
      // установка не рушится целиком (в отличие от cache.addAll).
      return Promise.all(CACHE_FILES.map(function (url) {
        // cache: 'reload' — обходим HTTP-кэш браузера, чтобы взять свежую версию
        return fetch(new Request(url, { cache: 'reload' }))
          .then(function (response) {
            if (!response || !response.ok) {
              throw new Error('HTTP ' + (response && response.status));
            }
            return cache.put(url, response);
          })
          .catch(function (err) {
            console.warn('[NB SW] Не удалось закэшировать: ' + url, err);
          });
      }));
    }).then(function () {
      // Не ждём закрытия старых вкладок — новый воркер сразу готов к активации
      return self.skipWaiting();
    })
  );
});

// --------------------------------------------------------------------------
// activate: удаляем старые кэши NaebBet и берём управление страницами
// --------------------------------------------------------------------------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// --------------------------------------------------------------------------
// fetch: cache-first. Сначала кэш, при промахе — сеть с докэшированием
// --------------------------------------------------------------------------
self.addEventListener('fetch', function (event) {
  const request = event.request;

  // Обрабатываем только GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Только свой origin (внешних ресурсов в проекте нет)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      return fetch(request).then(function (response) {
        // Докладываем в кэш только успешные ответы
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        // Сети нет и в кэше пусто: для переходов по страницам отдаём index.html
        if (request.mode === 'navigate') {
          return caches.match(FALLBACK_PAGE);
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// --------------------------------------------------------------------------
// message: ручной запуск обновления из приложения
// navigator.serviceWorker.controller.postMessage('SKIP_WAITING')
// --------------------------------------------------------------------------
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});