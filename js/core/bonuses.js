/* ============================================================
   NaebBet — js/core/bonuses.js
   Модуль NB.Bonuses: ежедневный бонус с серией, бонус при
   банкротстве, бесплатное колесо раз в сутки, защита от
   перевода часов назад.
   ============================================================ */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};

  // ---------- Константы ----------
  var STORAGE_KEY = 'nb_bonuses';
  var HOUR_MS = 60 * 60 * 1000;
  var DAILY_REWARDS = [500, 750, 1000, 1500, 2000, 3000, 5000]; // награды за дни серии 1..7
  var BANKRUPT_REWARD = 1500;          // бонус при банкротстве
  var BANKRUPT_COOLDOWN = HOUR_MS;     // не чаще раза в час
  var DEFAULT_MIN_BET = 10;            // порог банкротства, если игры не зарегистрированы
  var SAVE_THROTTLE_MS = 5000;         // не пишем в хранилище чаще, чем раз в 5 сек
  var TAMPER_TOLERANCE_MS = 2000;      // допуск на мелкие подстройки часов

  // Сегменты бесплатного колеса: сумма и вес (шанс)
  var WHEEL_SEGMENTS = [
    { amount: 100,  weight: 25, label: '100',  color: '#6c3bd1' },
    { amount: 250,  weight: 22, label: '250',  color: '#8b5cf6' },
    { amount: 500,  weight: 18, label: '500',  color: '#6c3bd1' },
    { amount: 750,  weight: 14, label: '750',  color: '#8b5cf6' },
    { amount: 1000, weight: 10, label: '1000', color: '#d4a017' },
    { amount: 1500, weight: 7,  label: '1500', color: '#8b5cf6' },
    { amount: 2500, weight: 3,  label: '2500', color: '#d4a017' },
    { amount: 5000, weight: 1,  label: '5000', color: '#ffd700' }
  ];

  // ---------- Состояние ----------
  var state = null;        // загруженное состояние
  var lastSaveAt = 0;      // время последней записи (реальное)
  var watchers = [];       // активные подписки watch()
  var balanceHandler = null;
  var bankruptNotified = false;

  function defaultState() {
    var now = Date.now();
    return {
      v: 1,
      lastReal: now,       // последнее увиденное реальное время
      lastEff: now,        // последнее «эффективное» (монотонное) время
      dailyLastDay: null,  // номер дня последнего ежедневного бонуса
      streak: 0,           // текущая серия дней
      bankruptLastTs: 0,   // эффективное время последнего бонуса банкротства
      wheelLastDay: null,  // номер дня последнего вращения колеса
      tamperCount: 0,      // сколько раз замечен перевод часов назад
      totalClaimed: 0      // всего получено бонусов
    };
  }

  // Загрузка состояния из NB.Storage (с запасным вариантом)
  function load() {
    var s = null;
    try {
      if (NB.Storage && typeof NB.Storage.get === 'function') {
        s = NB.Storage.get(STORAGE_KEY, null);
      }
    } catch (e) { s = null; }
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    // Подмешиваем значения по умолчанию (миграция полей)
    for (var k in d) {
      if (Object.prototype.hasOwnProperty.call(d, k) && typeof s[k] === 'undefined') s[k] = d[k];
    }
    return s;
  }

  function save(force) {
    var real = Date.now();
    if (!force && real - lastSaveAt < SAVE_THROTTLE_MS) return;
    lastSaveAt = real;
    try {
      if (NB.Storage && typeof NB.Storage.set === 'function') {
        NB.Storage.set(STORAGE_KEY, state);
      }
    } catch (e) { /* хранилище недоступно — работаем в памяти */ }
  }

  // ---------- Надёжное время ----------
  // «Эффективное» время идёт только вперёд: прирост берём из реальных
  // часов, а отрицательный скачок (перевод часов назад) игнорируем.
  function now() {
    if (!state) state = load();
    var real = Date.now();
    var delta = real - state.lastReal;
    var tampered = false;

    if (delta < -TAMPER_TOLERANCE_MS) {
      // Часы переведены назад — время не откатываем
      tampered = true;
      state.tamperCount = (state.tamperCount || 0) + 1;
      delta = 0;
    } else if (delta < 0) {
      delta = 0;
    }

    state.lastEff += delta;
    state.lastReal = real;

    if (tampered) {
      save(true);
      try {
        if (NB.Events) NB.Events.emit('bonus:clock-warning', { count: state.tamperCount });
      } catch (e) { /* ignore */ }
    } else {
      save(false);
    }
    return state.lastEff;
  }

  // Номер календарного дня по локальной дате (устойчиво к переходу на летнее время)
  function dayKey(ts) {
    var d = new Date(ts);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  // Время начала следующего локального дня
  function nextMidnight(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  // ---------- Вспомогательное ----------
  function emit(name, data) {
    try { if (NB.Events) NB.Events.emit(name, data); } catch (e) { /* ignore */ }
  }

  function addCoins(amount, reason) {
    if (NB.Wallet && typeof NB.Wallet.add === 'function') {
      NB.Wallet.add(amount, reason);
    }
  }

  function addXp(n) {
    try { if (NB.Levels && typeof NB.Levels.addXp === 'function') NB.Levels.addXp(n); } catch (e) { /* ignore */ }
  }

  function balance() {
    return (NB.Wallet && typeof NB.Wallet.getBalance === 'function') ? NB.Wallet.getBalance() : 0;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Формат обратного отсчёта ЧЧ:ММ:СС
  function formatCountdown(ms) {
    if (ms < 0) ms = 0;
    var total = Math.ceil(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  // ---------- Ежедневный бонус ----------
  function getDailyInfo() {
    var t = now();
    var today = dayKey(t);
    var last = state.dailyLastDay;
    var available, day, broken = false;

    if (last === today) {
      // Сегодня уже забрали: показываем, что будет завтра
      available = false;
      day = Math.min(state.streak + 1, DAILY_REWARDS.length);
    } else if (last === today - 1) {
      available = true;
      day = Math.min(state.streak + 1, DAILY_REWARDS.length);
    } else {
      // Пропуск (или первый запуск) — серия начинается заново
      available = true;
      day = 1;
      broken = last !== null && state.streak > 0;
    }

    var nextAt = available ? t : nextMidnight(t);
    return {
      available: available,
      day: day,                              // день серии (1..7), который будет получен
      streak: (last === today || last === today - 1) ? state.streak : 0,
      reward: DAILY_REWARDS[day - 1],
      rewards: DAILY_REWARDS.slice(),
      streakBroken: broken,
      nextAt: nextAt,
      msLeft: available ? 0 : nextAt - t
    };
  }

  function claimDaily() {
    var info = getDailyInfo();
    if (!info.available) {
      return { ok: false, reason: 'already-claimed', msLeft: info.msLeft };
    }
    var t = now();
    state.streak = info.streakBroken || info.streak === 0 ? 1 : info.streak + 1;
    state.dailyLastDay = dayKey(t);
    var day = Math.min(state.streak, DAILY_REWARDS.length);
    var amount = DAILY_REWARDS[day - 1];
    state.totalClaimed += amount;
    save(true);

    addCoins(amount, 'daily-bonus');
    addXp(10 + day * 2);
    emit('bonus:claimed', { type: 'daily', amount: amount, day: day, streak: state.streak });
    return { ok: true, amount: amount, day: day, streak: state.streak };
  }

  function getTimeToNextDaily() {
    return getDailyInfo().msLeft;
  }

  // ---------- Бонус при банкротстве ----------
  // Минимальная ставка среди всех игр (порог банкротства)
  function getMinBet() {
    var min = Infinity;
    try {
      if (NB.Games && typeof NB.Games.getAll === 'function') {
        var list = NB.Games.getAll() || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && typeof list[i].minBet === 'number' && list[i].minBet < min) min = list[i].minBet;
        }
      }
    } catch (e) { /* ignore */ }
    return isFinite(min) ? min : DEFAULT_MIN_BET;
  }

  function isBankrupt() {
    return balance() < getMinBet();
  }

  function getBankruptcyInfo() {
    var t = now();
    var since = t - state.bankruptLastTs;
    var cooldownLeft = state.bankruptLastTs ? Math.max(0, BANKRUPT_COOLDOWN - since) : 0;
    var bankrupt = isBankrupt();
    return {
      bankrupt: bankrupt,
      available: bankrupt && cooldownLeft === 0,
      reward: BANKRUPT_REWARD,
      cooldownLeft: cooldownLeft
    };
  }

  function canClaimBankruptcy() {
    return getBankruptcyInfo().available;
  }

  function claimBankruptcy() {
    var info = getBankruptcyInfo();
    if (!info.bankrupt) return { ok: false, reason: 'not-bankrupt' };
    if (info.cooldownLeft > 0) return { ok: false, reason: 'cooldown', msLeft: info.cooldownLeft };

    state.bankruptLastTs = now();
    state.totalClaimed += BANKRUPT_REWARD;
    bankruptNotified = false;
    save(true);

    addCoins(BANKRUPT_REWARD, 'bankruptcy-bonus');
    emit('bonus:claimed', { type: 'bankruptcy', amount: BANKRUPT_REWARD });
    return { ok: true, amount: BANKRUPT_REWARD };
  }

  // ---------- Бесплатное колесо ----------
  function getWheelSegments() {
    return WHEEL_SEGMENTS.map(function (s) {
      return { amount: s.amount, label: s.label, color: s.color };
    });
  }

  function getWheelInfo() {
    var t = now();
    var today = dayKey(t);
    var available = state.wheelLastDay !== today;
    var nextAt = available ? t : nextMidnight(t);
    return {
      available: available,
      nextAt: nextAt,
      msLeft: available ? 0 : nextAt - t,
      segments: getWheelSegments()
    };
  }

  // Выбор сегмента по весам через NB.RNG (с запасным вариантом)
  function pickSegmentIndex() {
    var idx = [], weights = [];
    for (var i = 0; i < WHEEL_SEGMENTS.length; i++) {
      idx.push(i);
      weights.push(WHEEL_SEGMENTS[i].weight);
    }
    if (NB.RNG && typeof NB.RNG.weighted === 'function') {
      var r = NB.RNG.weighted(idx, weights);
      if (typeof r === 'number' && r >= 0 && r < WHEEL_SEGMENTS.length) return r;
    }
    // Запасной вариант на crypto
    var total = 0, j;
    for (j = 0; j < weights.length; j++) total += weights[j];
    var buf = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    var x = (buf[0] / 4294967296) * total;
    for (j = 0; j < weights.length; j++) {
      x -= weights[j];
      if (x < 0) return j;
    }
    return weights.length - 1;
  }

  // Вращение: результат определяется сразу, UI лишь анимирует вращение к index
  function spinWheel() {
    var info = getWheelInfo();
    if (!info.available) return { ok: false, reason: 'already-spun', msLeft: info.msLeft };

    var index = pickSegmentIndex();
    var amount = WHEEL_SEGMENTS[index].amount;

    state.wheelLastDay = dayKey(now());
    state.totalClaimed += amount;
    save(true);

    addCoins(amount, 'wheel-bonus');
    addXp(15);
    emit('bonus:claimed', { type: 'wheel', amount: amount, index: index });
    return { ok: true, index: index, amount: amount, segments: getWheelSegments() };
  }

  // ---------- Общий статус и подписка на таймеры ----------
  function getStatus() {
    return {
      daily: getDailyInfo(),
      bankruptcy: getBankruptcyInfo(),
      wheel: getWheelInfo(),
      tamperCount: state.tamperCount || 0,
      totalClaimed: state.totalClaimed || 0
    };
  }

  // Подписка на обновление раз в секунду; возвращает функцию отписки
  function watch(fn, intervalMs) {
    if (typeof fn !== 'function') return function () {};
    var timer = setInterval(function () {
      try { fn(getStatus()); } catch (e) { /* ошибка подписчика не должна ломать таймер */ }
    }, intervalMs || 1000);
    var rec = { timer: timer };
    watchers.push(rec);
    try { fn(getStatus()); } catch (e) { /* ignore */ }
    return function stop() {
      clearInterval(timer);
      var i = watchers.indexOf(rec);
      if (i >= 0) watchers.splice(i, 1);
    };
  }

  // Остановить все подписки (на случай выхода с экрана)
  function stopAllWatchers() {
    for (var i = 0; i < watchers.length; i++) clearInterval(watchers[i].timer);
    watchers.length = 0;
  }

  // Сброс данных бонусов (для resetAll)
  function reset() {
    state = defaultState();
    bankruptNotified = false;
    save(true);
  }

  // ---------- Инициализация ----------
  function init() {
    state = load();
    now(); // первичная синхронизация времени и проверка на перевод часов

    // Оповещаем, когда доступен бонус банкротства (один раз на «банкротство»)
    if (NB.Events && typeof NB.Events.on === 'function') {
      balanceHandler = function () {
        var info = getBankruptcyInfo();
        if (info.available && !bankruptNotified) {
          bankruptNotified = true;
          emit('bonus:bankruptcy-available', { reward: BANKRUPT_REWARD });
        } else if (!info.bankrupt) {
          bankruptNotified = false;
        }
      };
      NB.Events.on('balance:change', balanceHandler);
    }

    // Сохраняем время при сворачивании/закрытии вкладки
    window.addEventListener('pagehide', function () { now(); save(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { now(); save(true); }
    });
  }

  // ---------- Публичный API ----------
  NB.Bonuses = {
    // Ежедневный бонус
    getDailyInfo: getDailyInfo,
    canClaimDaily: function () { return getDailyInfo().available; },
    claimDaily: claimDaily,
    getTimeToNextDaily: getTimeToNextDaily,
    // Банкротство
    getBankruptcyInfo: getBankruptcyInfo,
    canClaimBankruptcy: canClaimBankruptcy,
    claimBankruptcy: claimBankruptcy,
    // Колесо
    getWheelInfo: getWheelInfo,
    getWheelSegments: getWheelSegments,
    canSpinWheel: function () { return getWheelInfo().available; },
    spinWheel: spinWheel,
    // Общее
    getStatus: getStatus,
    watch: watch,
    stopAllWatchers: stopAllWatchers,
    formatCountdown: formatCountdown,
    getNow: now,
    reset: reset
  };

  init();
})();