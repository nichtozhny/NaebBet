/**
 * NaebBet — js/core/namespace.js
 * Глобальное пространство имён NB, конфигурация, утилиты и перехват ошибок.
 * Подключается ПЕРВЫМ среди всех скриптов.
 */
(function (global) {
  'use strict';

  // Если NB уже существует (повторная загрузка скрипта) — дополняем, а не затираем
  var NB = global.NB || {};

  // ---------------------------------------------------------------------------
  // Основные поля
  // ---------------------------------------------------------------------------
  NB.version = '1.0.0';
  NB.name = 'NaebBet';

  // Флаг отладки: включается через ?debug=1 в адресе или вручную: NB.debug = true
  NB.debug = false;
  try {
    if (global.location && /[?&]debug=1(?:&|$)/.test(global.location.search)) {
      NB.debug = true;
    }
  } catch (e) { /* игнорируем — в некоторых контекстах location недоступен */ }

  // ---------------------------------------------------------------------------
  // Конфигурация (виртуальная валюта "NB-монеты")
  // ---------------------------------------------------------------------------
  NB.config = {
    startBalance: 10000,    // стартовый баланс
    minBet: 10,             // минимальная ставка по умолчанию
    maxBet: 100000,         // максимальная ставка по умолчанию
    bankruptcyBonus: 1000,  // бонус при банкротстве
    dailyBonusBase: 500,    // базовый ежедневный бонус
    xpPerBetRatio: 0.1      // доля ставки, превращаемая в опыт
  };

  // ---------------------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------------------
  NB.utils = NB.utils || {};

  /**
   * Ограничивает число n диапазоном [min, max].
   * Нечисловые значения приводятся к min.
   */
  function clamp(n, min, max) {
    n = Number(n);
    min = Number(min);
    max = Number(max);
    if (min > max) { var t = min; min = max; max = t; }
    if (!isFinite(n)) return min;
    return n < min ? min : (n > max ? max : n);
  }

  /** Дополняет число нулём слева до двух знаков. */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /**
   * Форматирует дату в строку «ДД.ММ.ГГГГ ЧЧ:ММ».
   * Принимает Date, timestamp или строку. При withTime === false время не выводится.
   */
  function formatDate(ts, withTime) {
    var d = ts instanceof Date ? ts : new Date(ts === undefined ? Date.now() : ts);
    if (isNaN(d.getTime())) return '—';
    var res = pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
    if (withTime !== false) {
      res += ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return res;
  }

  /**
   * Генерирует уникальный идентификатор.
   * Использует crypto.getRandomValues, при его отсутствии — Math.random.
   */
  function uid(prefix) {
    var rnd = '';
    try {
      var arr = new Uint32Array(2);
      global.crypto.getRandomValues(arr);
      rnd = arr[0].toString(36) + arr[1].toString(36);
    } catch (e) {
      rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return (prefix ? String(prefix) + '_' : '') + Date.now().toString(36) + rnd;
  }

  /**
   * Возвращает функцию-обёртку, откладывающую вызов fn на wait мс
   * после последнего обращения. Есть метод cancel() для отмены.
   */
  function debounce(fn, wait) {
    var timer = null;
    wait = wait === undefined ? 200 : wait;
    function debounced() {
      var ctx = this;
      var args = arguments;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    }
    debounced.cancel = function () {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }

  NB.utils.clamp = clamp;
  NB.utils.formatDate = formatDate;
  NB.utils.uid = uid;
  NB.utils.debounce = debounce;

  // Короткие псевдонимы на верхнем уровне для удобства
  NB.clamp = clamp;
  NB.formatDate = formatDate;
  NB.uid = uid;
  NB.debounce = debounce;

  // ---------------------------------------------------------------------------
  // Журнал ошибок
  // ---------------------------------------------------------------------------
  var ERROR_LOG_KEY = 'error_log'; // итоговый ключ в хранилище получит префикс "nb_"
  var ERROR_LOG_LIMIT = 50;
  var inErrorHandler = false;      // защита от рекурсии при ошибке внутри обработчика

  /**
   * Записывает ошибку в журнал NB.Storage (последние 50 записей).
   * Если Storage ещё не загружен — молча пропускает запись.
   */
  function logError(entry) {
    if (NB.debug && global.console && console.error) {
      console.error('[NaebBet]', entry);
    }
    if (!NB.Storage || typeof NB.Storage.get !== 'function' || typeof NB.Storage.set !== 'function') {
      return false;
    }
    try {
      var log = NB.Storage.get(ERROR_LOG_KEY, []);
      if (!Array.isArray(log)) log = [];
      log.push(entry);
      if (log.length > ERROR_LOG_LIMIT) {
        log = log.slice(log.length - ERROR_LOG_LIMIT);
      }
      NB.Storage.set(ERROR_LOG_KEY, log);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Возвращает сохранённый журнал ошибок. */
  function getErrorLog() {
    try {
      if (NB.Storage && typeof NB.Storage.get === 'function') {
        var log = NB.Storage.get(ERROR_LOG_KEY, []);
        return Array.isArray(log) ? log : [];
      }
    } catch (e) { /* игнорируем */ }
    return [];
  }

  /** Очищает журнал ошибок. */
  function clearErrorLog() {
    try {
      if (NB.Storage && typeof NB.Storage.remove === 'function') {
        NB.Storage.remove(ERROR_LOG_KEY);
      }
    } catch (e) { /* игнорируем */ }
  }

  NB.logError = logError;
  NB.getErrorLog = getErrorLog;
  NB.clearErrorLog = clearErrorLog;

  // ---------------------------------------------------------------------------
  // Глобальные обработчики ошибок
  // ---------------------------------------------------------------------------
  var prevOnError = global.onerror;

  global.onerror = function (message, source, lineno, colno, error) {
    if (!inErrorHandler) {
      inErrorHandler = true;
      try {
        logError({
          type: 'error',
          message: String(message),
          source: source || '',
          line: lineno || 0,
          col: colno || 0,
          stack: error && error.stack ? String(error.stack).slice(0, 1000) : '',
          ts: Date.now()
        });
      } catch (e) { /* обработчик не должен сам падать */ }
      inErrorHandler = false;
    }
    // Передаём управление ранее установленному обработчику, если он был
    if (typeof prevOnError === 'function') {
      try {
        return prevOnError.apply(this, arguments);
      } catch (e) { /* игнорируем */ }
    }
    return false; // стандартная обработка браузера сохраняется
  };

  // Необработанные отклонения промисов тоже попадают в журнал
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('unhandledrejection', function (ev) {
      if (inErrorHandler) return;
      inErrorHandler = true;
      try {
        var reason = ev && ev.reason;
        logError({
          type: 'unhandledrejection',
          message: reason && reason.message ? String(reason.message) : String(reason),
          source: '',
          line: 0,
          col: 0,
          stack: reason && reason.stack ? String(reason.stack).slice(0, 1000) : '',
          ts: Date.now()
        });
      } catch (e) { /* игнорируем */ }
      inErrorHandler = false;
    });
  }

  // Публикуем глобальный объект
  global.NB = NB;

})(typeof window !== 'undefined' ? window : this);