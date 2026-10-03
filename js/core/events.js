/**
 * NaebBet — js/core/events.js
 * Модуль NB.Events: простая шина событий (publish/subscribe).
 *
 * Публичный API:
 *   NB.Events.on(name, fn)    — подписка на событие, возвращает функцию отписки
 *   NB.Events.off(name, fn)   — отписка от события
 *   NB.Events.once(name, fn)  — одноразовая подписка (сработает один раз)
 *   NB.Events.emit(name, data)— генерация события, возвращает число вызванных слушателей
 *
 * Список событий проекта:
 *   balance:change       — изменился баланс. data: {balance, delta, reason}
 *   round:settled        — раунд завершён. data: {roundId, gameId, bet, payout, details, ts}
 *   level:up             — повышен уровень. data: {level, title, xp}
 *   achievement:unlocked — открыто достижение. data: {id, title, ...}
 *   screen:change        — сменился экран роутера. data: {from, to, params}
 *   settings:change      — изменены настройки. data: {key, value}
 *   bonus:claimed        — получен бонус. data: {type, amount}
 *
 * Особенности:
 *   - Ошибка в одном слушателе не ломает остальных (try/catch + лог в консоль).
 *   - Подписка/отписка во время emit безопасны (используется копия списка слушателей).
 *   - Повторная подписка одной и той же функции на одно событие игнорируется.
 */
(function (global) {
  'use strict';

  // Глобальный объект проекта (создаём, если ещё не существует)
  var NB = global.NB = global.NB || {};

  // Хранилище слушателей: имя события -> массив записей {fn, orig}
  // orig — исходная функция (нужна для off() у обёрток once)
  var listeners = Object.create(null);

  /** Проверка корректности аргументов */
  function checkArgs(name, fn, method) {
    if (typeof name !== 'string' || !name) {
      throw new TypeError('NB.Events.' + method + ': имя события должно быть непустой строкой');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('NB.Events.' + method + ': слушатель должен быть функцией');
    }
  }

  /** Подписка на событие. Возвращает функцию отписки. */
  function on(name, fn) {
    checkArgs(name, fn, 'on');
    var list = listeners[name] || (listeners[name] = []);
    // Защита от дублей одной и той же функции
    for (var i = 0; i < list.length; i++) {
      if (list[i].orig === fn && !list[i].once) {
        return function () { off(name, fn); };
      }
    }
    list.push({ fn: fn, orig: fn, once: false });
    return function () { off(name, fn); };
  }

  /** Одноразовая подписка. Возвращает функцию отписки. */
  function once(name, fn) {
    checkArgs(name, fn, 'once');
    var list = listeners[name] || (listeners[name] = []);
    var entry = { fn: null, orig: fn, once: true };
    entry.fn = function (data) {
      // Сначала отписываемся, затем вызываем — чтобы исключить повторный вызов
      removeEntry(name, entry);
      return fn(data);
    };
    list.push(entry);
    return function () { removeEntry(name, entry); };
  }

  /** Удаление конкретной записи слушателя */
  function removeEntry(name, entry) {
    var list = listeners[name];
    if (!list) return;
    var idx = list.indexOf(entry);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) delete listeners[name];
  }

  /** Отписка от события (удаляет и обычные, и once-подписки данной функции). */
  function off(name, fn) {
    if (typeof name !== 'string' || !name) return;
    var list = listeners[name];
    if (!list) return;
    // Если fn не передан — снимаем всех слушателей события
    if (typeof fn !== 'function') {
      delete listeners[name];
      return;
    }
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].orig === fn) list.splice(i, 1);
    }
    if (list.length === 0) delete listeners[name];
  }

  /** Генерация события. Возвращает количество вызванных слушателей. */
  function emit(name, data) {
    if (typeof name !== 'string' || !name) return 0;
    var list = listeners[name];
    if (!list || list.length === 0) return 0;

    // Работаем с копией, чтобы on/off внутри слушателей не ломали обход
    var snapshot = list.slice();
    var called = 0;
    for (var i = 0; i < snapshot.length; i++) {
      var entry = snapshot[i];
      // Слушатель мог быть удалён предыдущим слушателем в этом же emit
      var cur = listeners[name];
      if (!cur || cur.indexOf(entry) === -1) continue;
      try {
        entry.fn(data);
      } catch (err) {
        if (global.console && typeof console.error === 'function') {
          console.error('[NB.Events] Ошибка в слушателе события "' + name + '":', err);
        }
      }
      called++;
    }
    return called;
  }

  // Публикация модуля
  NB.Events = {
    on: on,
    off: off,
    once: once,
    emit: emit
  };
})(typeof window !== 'undefined' ? window : this);