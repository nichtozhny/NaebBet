/* ==========================================================================
   NaebBet — js/core/storage.js
   Модуль NB.Storage: надёжное хранилище поверх localStorage.
   - префикс ключей "nb_", значения в JSON
   - защита от переполнения квоты и повреждённых данных
   - версия схемы + миграции
   - резервная копия: exportAll() / importAll(json)
   - если localStorage недоступен, данные хранятся в памяти
   ========================================================================== */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  var NB = root.NB = root.NB || {};

  // ------------------------------------------------------------------
  // Константы
  // ------------------------------------------------------------------
  var PREFIX = 'nb_';                          // префикс всех ключей приложения
  var VERSION_KEY = PREFIX + 'schema_version'; // служебный ключ версии схемы
  var PROBE_KEY = PREFIX + '_probe';           // ключ для проверки доступности
  var CURRENT_VERSION = 1;                     // текущая версия схемы данных
  var APP_ID = 'NaebBet';                      // метка приложения в бэкапе

  var MAX_VALUE_CHARS = 2 * 1024 * 1024;       // максимум на одно значение
  var MAX_IMPORT_CHARS = 5 * 1024 * 1024;      // максимум размера файла импорта
  var MAX_IMPORT_KEYS = 500;                   // максимум ключей в импорте
  var MAX_KEY_LENGTH = 100;                    // максимум длины ключа
  var KEY_RE = /^[A-Za-z0-9_.:\-]{1,100}$/;    // допустимые имена ключей (без префикса)

  // Ключи, которые можно безопасно удалять при нехватке места (кэш, логи)
  var EVICTABLE_PREFIXES = [PREFIX + 'cache_', PREFIX + 'log_', PREFIX + 'tmp_'];

  // Зарезервированные короткие имена (без префикса)
  var RESERVED = { 'schema_version': true, '_probe': true };

  // ------------------------------------------------------------------
  // Миграции схемы.
  // MIGRATIONS[n] переводит данные с версии n-1 на версию n.
  // Функция получает объект { короткийКлюч: значение } и возвращает новый
  // (или изменённый) объект. Миграции должны быть идемпотентными.
  // Пример для будущего:
  //   2: function (data) { if (data.wallet) data.wallet.v = 2; return data; }
  // ------------------------------------------------------------------
  var MIGRATIONS = {
    1: function (data) {
      // v0 -> v1: первая версия схемы, данные остаются как есть
      return data;
    }
  };

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------

  // Безопасная отправка события (NB.Events может быть ещё не загружен)
  function emit(name, data) {
    try {
      if (NB.Events && typeof NB.Events.emit === 'function') {
        NB.Events.emit(name, data);
      }
    } catch (e) { /* подписчики не должны ломать хранилище */ }
  }

  function warn() {
    try {
      if (root.console && root.console.warn) {
        root.console.warn.apply(root.console, ['[NB.Storage]'].concat([].slice.call(arguments)));
      }
    } catch (e) { /* ничего */ }
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // Глубокая копия через JSON
  function deepCopy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  // Безопасная сериализация: возвращает строку или null
  function serialize(val) {
    try {
      var s = JSON.stringify(val);
      return typeof s === 'string' ? s : null; // undefined/функции -> null
    } catch (e) {
      return null; // циклические ссылки и т.п.
    }
  }

  // ------------------------------------------------------------------
  // Бэкенды хранения
  // ------------------------------------------------------------------

  // Бэкенд в памяти (запасной вариант)
  function createMemoryBackend() {
    var map = {};
    return {
      persistent: false,
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; },
      keys: function () { return Object.keys(map); }
    };
  }

  // Бэкенд поверх localStorage
  function createLocalBackend(ls) {
    return {
      persistent: true,
      getItem: function (k) { return ls.getItem(k); },
      setItem: function (k, v) { ls.setItem(k, v); },
      removeItem: function (k) { ls.removeItem(k); },
      keys: function () {
        var out = [];
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      }
    };
  }

  // Проверка доступности localStorage (приватный режим, запреты, переполнение)
  function detectLocalStorage() {
    try {
      var ls = root.localStorage;
      if (!ls) return null;
      ls.setItem(PROBE_KEY, '1');
      ls.removeItem(PROBE_KEY);
      return ls;
    } catch (e) {
      return null;
    }
  }

  var ls = detectLocalStorage();
  var backend = ls ? createLocalBackend(ls) : createMemoryBackend();

  // Значения, которые не удалось записать в localStorage (переполнение):
  // живут в памяти до перезагрузки страницы. Хранятся как JSON-строки.
  var overflow = {};
  var overflowWarned = false;

  // ------------------------------------------------------------------
  // Низкоуровневые операции с полными ключами
  // ------------------------------------------------------------------

  // Полный ключ из публичного имени. Возвращает null, если имя недопустимо.
  function toFullKey(key) {
    if (typeof key !== 'string' && typeof key !== 'number') return null;
    var k = String(key);
    if (k.indexOf(PREFIX) !== 0) k = PREFIX + k;
    var short = k.slice(PREFIX.length);
    if (!KEY_RE.test(short) || RESERVED[short]) return null;
    return k;
  }

  function toShortKey(full) {
    return full.slice(PREFIX.length);
  }

  // Список полных пользовательских ключей из бэкенда (без служебных)
  function listBackendKeys() {
    var out = [];
    try {
      var all = backend.keys();
      for (var i = 0; i < all.length; i++) {
        var k = all[i];
        if (k.indexOf(PREFIX) === 0 && k !== VERSION_KEY && k !== PROBE_KEY) out.push(k);
      }
    } catch (e) { /* ничего */ }
    return out;
  }

  // Все полные ключи: бэкенд + переполнение
  function listAllKeys() {
    var seen = {};
    var out = [];
    listBackendKeys().forEach(function (k) { seen[k] = true; out.push(k); });
    Object.keys(overflow).forEach(function (k) { if (!seen[k]) out.push(k); });
    return out;
  }

  // Освобождение места: удаляем кэш/логи. Возвращает число удалённых ключей.
  function evict() {
    var removed = 0;
    listBackendKeys().forEach(function (k) {
      for (var i = 0; i < EVICTABLE_PREFIXES.length; i++) {
        if (k.indexOf(EVICTABLE_PREFIXES[i]) === 0) {
          try { backend.removeItem(k); removed++; } catch (e) { /* ничего */ }
          break;
        }
      }
    });
    return removed;
  }

  // Запись строки в бэкенд. allowOverflow=true: при неудаче значение
  // сохраняется в памяти. Возвращает true, если записано на постоянное хранение.
  function writeRaw(fullKey, str, allowOverflow) {
    if (str.length > MAX_VALUE_CHARS) {
      emit('storage:error', { type: 'too_large', key: toShortKey(fullKey) });
      return false;
    }
    var ok = false;
    try {
      backend.setItem(fullKey, str);
      ok = true;
    } catch (e1) {
      // Вероятно, переполнение квоты: освобождаем место и пробуем ещё раз
      try {
        if (evict() > 0) {
          backend.setItem(fullKey, str);
          ok = true;
        }
      } catch (e2) { ok = false; }
    }
    if (ok) {
      delete overflow[fullKey];
      return true;
    }
    if (allowOverflow) {
      overflow[fullKey] = str; // держим в памяти до перезагрузки
      if (!overflowWarned) {
        overflowWarned = true;
        warn('Не удалось записать в localStorage (переполнение?). Данные держатся в памяти.');
      }
      emit('storage:error', { type: 'quota', key: toShortKey(fullKey) });
    }
    return false;
  }

  // Чтение строки: сначала память-переполнение, затем бэкенд
  function readRaw(fullKey) {
    if (Object.prototype.hasOwnProperty.call(overflow, fullKey)) return overflow[fullKey];
    try {
      return backend.getItem(fullKey);
    } catch (e) {
      return null;
    }
  }

  function removeRaw(fullKey) {
    delete overflow[fullKey];
    try { backend.removeItem(fullKey); } catch (e) { /* ничего */ }
  }

  // Снимок всех пользовательских данных: { короткийКлюч: значение }
  // Повреждённые записи пропускаются.
  function collectData() {
    var data = {};
    listAllKeys().forEach(function (full) {
      var raw = readRaw(full);
      if (raw === null) return;
      try {
        data[toShortKey(full)] = JSON.parse(raw);
      } catch (e) { /* повреждённая запись — пропускаем */ }
    });
    return data;
  }

  // Удаление всех пользовательских данных (версия схемы не трогается)
  function clearUserData() {
    listAllKeys().forEach(removeRaw);
    overflow = {};
  }

  // Запись версии схемы
  function writeVersion(v) {
    try { backend.setItem(VERSION_KEY, String(v)); return true; } catch (e) { return false; }
  }

  // ------------------------------------------------------------------
  // Миграции
  // ------------------------------------------------------------------

  // Применяет цепочку миграций к объекту данных начиная с версии from
  function migrateData(data, from) {
    var cur = data;
    for (var v = from + 1; v <= CURRENT_VERSION; v++) {
      var fn = MIGRATIONS[v];
      if (typeof fn === 'function') {
        var res = fn(cur);
        if (isPlainObject(res)) cur = res;
      }
    }
    return cur;
  }

  // Инициализация: определяем версию схемы и при необходимости мигрируем
  function init() {
    var rawVer = null;
    try { rawVer = backend.getItem(VERSION_KEY); } catch (e) { rawVer = null; }

    var keys = listBackendKeys();

    // Чистое хранилище: просто ставим текущую версию
    if (rawVer === null && keys.length === 0) {
      writeVersion(CURRENT_VERSION);
      return;
    }

    var ver = parseInt(rawVer, 10);
    if (isNaN(ver) || ver < 0) ver = 0; // нет версии или она повреждена

    if (ver > CURRENT_VERSION) {
      // Данные из более новой версии приложения: ничего не трогаем
      warn('Версия схемы данных (' + ver + ') новее поддерживаемой (' + CURRENT_VERSION + ').');
      return;
    }
    if (ver === CURRENT_VERSION) return;

    // Миграция: читаем всё, прогоняем через цепочку, записываем обратно
    try {
      var before = collectData();
      var after = migrateData(deepCopy(before), ver);
      var allOk = true;

      Object.keys(after).forEach(function (short) {
        if (!KEY_RE.test(short) || RESERVED[short]) return;
        var str = serialize(after[short]);
        if (str === null) return;
        if (!writeRaw(PREFIX + short, str, true)) allOk = false;
      });
      // Удаляем ключи, убранные миграцией
      Object.keys(before).forEach(function (short) {
        if (!Object.prototype.hasOwnProperty.call(after, short)) removeRaw(PREFIX + short);
      });

      // Версию повышаем только при полностью успешной записи,
      // иначе миграция повторится при следующем запуске (она идемпотентна)
      if (allOk) writeVersion(CURRENT_VERSION);
    } catch (e) {
      warn('Ошибка миграции данных:', e && e.message);
      emit('storage:error', { type: 'migration', message: e && e.message });
    }
  }

  // ------------------------------------------------------------------
  // Валидация импорта
  // ------------------------------------------------------------------

  // Проверка объекта данных. Возвращает строку с ошибкой или null.
  function validateData(data) {
    if (!isPlainObject(data)) return 'Поле data должно быть объектом';
    var keys = Object.keys(data);
    if (keys.length > MAX_IMPORT_KEYS) return 'Слишком много ключей в резервной копии';
    var total = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.length > MAX_KEY_LENGTH || !KEY_RE.test(k)) return 'Недопустимое имя ключа: ' + k.slice(0, 30);
      if (RESERVED[k]) return 'Зарезервированное имя ключа: ' + k;
      var s = serialize(data[k]);
      if (s === null) return 'Значение ключа "' + k + '" нельзя сохранить';
      if (s.length > MAX_VALUE_CHARS) return 'Значение ключа "' + k + '" слишком большое';
      total += s.length;
    }
    if (total > MAX_IMPORT_CHARS) return 'Резервная копия слишком большая';
    return null;
  }

  // ------------------------------------------------------------------
  // Публичный API
  // ------------------------------------------------------------------
  var Storage = {

    // Получить значение. При отсутствии/повреждении вернёт def.
    get: function (key, def) {
      var full = toFullKey(key);
      if (full === null) return def;
      var raw = readRaw(full);
      if (raw === null || raw === undefined) return def;
      try {
        return JSON.parse(raw);
      } catch (e) {
        // Повреждённая запись: удаляем, чтобы не мешала
        removeRaw(full);
        warn('Повреждённые данные удалены:', toShortKey(full));
        emit('storage:error', { type: 'corrupt', key: toShortKey(full) });
        return def;
      }
    },

    // Сохранить значение. true — записано в постоянное хранилище.
    // false — не удалось (значение при переполнении всё равно доступно
    // в памяти до перезагрузки страницы).
    set: function (key, val) {
      var full = toFullKey(key);
      if (full === null) {
        warn('Недопустимый ключ:', key);
        return false;
      }
      if (val === undefined) { // undefined == удалить
        removeRaw(full);
        return true;
      }
      var str = serialize(val);
      if (str === null) {
        warn('Значение нельзя сериализовать:', key);
        emit('storage:error', { type: 'serialize', key: String(key) });
        return false;
      }
      return writeRaw(full, str, true);
    },

    // Удалить значение
    remove: function (key) {
      var full = toFullKey(key);
      if (full === null) return false;
      removeRaw(full);
      return true;
    },

    // Резервная копия: строка JSON со всеми данными приложения
    exportAll: function () {
      var payload = {
        app: APP_ID,
        schema: CURRENT_VERSION,
        exportedAt: Date.now(),
        data: collectData()
      };
      return JSON.stringify(payload);
    },

    // Восстановление из резервной копии (строка JSON).
    // Возвращает { ok: bool, count: число, error: строка|null }.
    // При ошибке прежние данные возвращаются на место.
    importAll: function (json) {
      function fail(msg) {
        emit('storage:error', { type: 'import', message: msg });
        return { ok: false, count: 0, error: msg };
      }

      if (typeof json !== 'string') return fail('Ожидалась строка JSON');
      if (json.length > MAX_IMPORT_CHARS) return fail('Файл резервной копии слишком большой');

      var payload;
      try {
        payload = JSON.parse(json);
      } catch (e) {
        return fail('Файл повреждён: это не корректный JSON');
      }

      if (!isPlainObject(payload)) return fail('Неверный формат резервной копии');
      if (payload.app !== APP_ID) return fail('Это не резервная копия NaebBet');
      var schema = payload.schema;
      if (typeof schema !== 'number' || !isFinite(schema) || Math.floor(schema) !== schema || schema < 0) {
        return fail('Некорректная версия схемы');
      }
      if (schema > CURRENT_VERSION) {
        return fail('Копия создана в более новой версии приложения');
      }

      var err = validateData(payload.data);
      if (err) return fail(err);

      // Миграция данных копии до текущей схемы
      var migrated;
      try {
        migrated = migrateData(deepCopy(payload.data), schema);
      } catch (e) {
        return fail('Ошибка миграции данных копии');
      }
      err = validateData(migrated);
      if (err) return fail(err);

      // Применение с откатом при сбое
      var snapshot = collectData();
      var keys = Object.keys(migrated);
      clearUserData();

      var failed = false;
      for (var i = 0; i < keys.length; i++) {
        var str = serialize(migrated[keys[i]]);
        if (str === null || !writeRaw(PREFIX + keys[i], str, false)) {
          failed = true;
          break;
        }
      }

      if (failed) {
        // Откат: возвращаем прежние данные
        clearUserData();
        Object.keys(snapshot).forEach(function (short) {
          var s = serialize(snapshot[short]);
          if (s !== null) writeRaw(PREFIX + short, s, true);
        });
        return fail('Не хватило места для восстановления данных');
      }

      writeVersion(CURRENT_VERSION);
      emit('storage:imported', { count: keys.length });
      return { ok: true, count: keys.length, error: null };
    },

    // Полный сброс всех данных приложения
    resetAll: function () {
      clearUserData();
      writeVersion(CURRENT_VERSION);
      emit('storage:reset', {});
      return true;
    },

    // Дополнительно: сохраняются ли данные между сессиями
    isPersistent: function () {
      return !!backend.persistent;
    },

    // Дополнительно: версия схемы (текущая в коде)
    getVersion: function () {
      return CURRENT_VERSION;
    }
  };

  NB.Storage = Storage;

  // Запуск проверки версии и миграций при загрузке модуля
  init();
})();