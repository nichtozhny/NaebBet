/*
 * NaebBet — js/core/wallet.js
 * Модуль NB.Wallet: виртуальный кошелёк (NB-монеты), ставки, выплаты,
 * восстановление незавершённых раундов и банкротский бонус.
 *
 * Зависимости (должны быть загружены раньше): NB.Storage, NB.Events.
 * Необязательные (используются, если уже загружены): NB.Stats, NB.Levels,
 * NB.Games, NB.UI, NB.RNG.
 */
(function (global) {
  'use strict';

  var NB = global.NB = global.NB || {};

  // ---------------------------------------------------------------------------
  // Константы
  // ---------------------------------------------------------------------------

  /** Ключ в хранилище. Баланс и открытые раунды лежат в ОДНОМ ключе,
   *  чтобы запись была атомарной и данные не могли рассинхронизироваться. */
  var KEY = 'nb_wallet';

  /** Стартовый баланс. */
  var START_BALANCE = 10000;

  /** Лимиты ставки по умолчанию (если игра не задала minBet/maxBet). */
  var DEFAULT_MIN_BET = 10;
  var DEFAULT_MAX_BET = 100000;

  /** Базовая сумма банкротского бонуса. */
  var BANKRUPT_BONUS = 5000;

  /** Верхняя граница баланса — защита от выхода за безопасные целые числа. */
  var MAX_BALANCE = 1e15;

  /** Сколько последних завершённых roundId помним для защиты от двойного settle. */
  var SETTLED_MEMORY = 300;

  // ---------------------------------------------------------------------------
  // Внутреннее состояние (только то, что не нужно хранить)
  // ---------------------------------------------------------------------------

  var settledIds = {};      // roundId -> true
  var settledOrder = [];    // очередь для вытеснения старых id
  var roundCounter = 0;     // счётчик для генерации roundId
  var bankruptPromptActive = false;
  var bankruptTimer = null;

  // ---------------------------------------------------------------------------
  // Вспомогательные функции
  // ---------------------------------------------------------------------------

  /** Создать ошибку с машинным кодом. */
  function makeError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /** Безопасная отправка события. */
  function emit(name, data) {
    if (NB.Events && typeof NB.Events.emit === 'function') {
      try {
        NB.Events.emit(name, data);
      } catch (e) {
        console.error('[Wallet] ошибка в обработчике события ' + name, e);
      }
    }
  }

  /** Форматирование суммы с запасным вариантом, если UI ещё не загружен. */
  function fmt(n) {
    if (NB.UI && typeof NB.UI.formatMoney === 'function') {
      try { return NB.UI.formatMoney(n); } catch (e) { /* fallthrough */ }
    }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** Безопасный тост. */
  function toast(text, type) {
    if (NB.UI && typeof NB.UI.toast === 'function') {
      try { NB.UI.toast(text, type || 'info'); } catch (e) { /* игнор */ }
    }
  }

  /** Проверка: конечное неотрицательное число. */
  function isMoney(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
  }

  // ---------------------------------------------------------------------------
  // Работа с хранилищем
  // ---------------------------------------------------------------------------

  /** Состояние по умолчанию. */
  function freshState() {
    return { v: 1, balance: START_BALANCE, open: {} };
  }

  /** Загрузить и провалидировать состояние кошелька. */
  function load() {
    var raw = NB.Storage.get(KEY, null);
    if (!raw || typeof raw !== 'object') return freshState();

    var balance = Number(raw.balance);
    if (!isFinite(balance) || balance < 0) balance = START_BALANCE;

    var open = {};
    if (raw.open && typeof raw.open === 'object') {
      Object.keys(raw.open).forEach(function (id) {
        var r = raw.open[id];
        if (r && typeof r === 'object' && isMoney(Number(r.bet))) {
          open[id] = {
            gameId: String(r.gameId || 'unknown'),
            bet: Number(r.bet),
            ts: Number(r.ts) || Date.now()
          };
        }
      });
    }
    return { v: 1, balance: Math.min(Math.floor(balance), MAX_BALANCE), open: open };
  }

  /** Сохранить состояние кошелька. */
  function save(state) {
    NB.Storage.set(KEY, state);
  }

  // ---------------------------------------------------------------------------
  // Лимиты ставок
  // ---------------------------------------------------------------------------

  /** Лимиты конкретной игры: берём из NB.Games, иначе значения по умолчанию. */
  function getLimits(gameId) {
    var min = DEFAULT_MIN_BET;
    var max = DEFAULT_MAX_BET;
    try {
      var g = NB.Games && typeof NB.Games.get === 'function' ? NB.Games.get(gameId) : null;
      if (g) {
        if (isFinite(g.minBet) && g.minBet > 0) min = Math.floor(g.minBet);
        if (isFinite(g.maxBet) && g.maxBet >= min) max = Math.floor(g.maxBet);
      }
    } catch (e) { /* используем значения по умолчанию */ }
    return { min: min, max: max };
  }

  /** Минимальная ставка среди всех игр (для проверки банкротства). */
  function getGlobalMinBet() {
    var min = Infinity;
    try {
      var all = NB.Games && typeof NB.Games.getAll === 'function' ? NB.Games.getAll() : [];
      if (!Array.isArray(all)) {
        all = all && typeof all === 'object'
          ? Object.keys(all).map(function (k) { return all[k]; })
          : [];
      }
      all.forEach(function (g) {
        if (g && isFinite(g.minBet) && g.minBet > 0) min = Math.min(min, g.minBet);
      });
    } catch (e) { /* игнор */ }
    return min === Infinity ? DEFAULT_MIN_BET : Math.floor(min);
  }

  // ---------------------------------------------------------------------------
  // Генерация roundId
  // ---------------------------------------------------------------------------

  function makeRoundId(openMap) {
    var id;
    do {
      roundCounter += 1;
      var rnd;
      if (NB.RNG && typeof NB.RNG.int === 'function') {
        rnd = NB.RNG.int(0, 0xFFFFFF).toString(36);
      } else {
        rnd = Math.floor(Math.random() * 0xFFFFFF).toString(36);
      }
      id = 'r_' + Date.now().toString(36) + '_' + roundCounter.toString(36) + '_' + rnd;
    } while (openMap[id] || settledIds[id]);
    return id;
  }

  /** Запомнить завершённый раунд (с ограничением размера памяти). */
  function rememberSettled(id) {
    settledIds[id] = true;
    settledOrder.push(id);
    while (settledOrder.length > SETTLED_MEMORY) {
      delete settledIds[settledOrder.shift()];
    }
  }

  // ---------------------------------------------------------------------------
  // Опыт за раунд
  // ---------------------------------------------------------------------------

  function calcXp(bet, payout) {
    var xp = 1 + Math.floor(bet / 50);
    if (xp > 50) xp = 50;
    if (payout > bet) xp += 2; // небольшой бонус за выигрыш
    return xp;
  }

  // ---------------------------------------------------------------------------
  // Публичный API
  // ---------------------------------------------------------------------------

  /** Текущий баланс. */
  function getBalance() {
    return load().balance;
  }

  /** Хватает ли средств на сумму n. */
  function canAfford(n) {
    n = Number(n);
    return isMoney(n) && getBalance() >= n;
  }

  /**
   * Сделать ставку: списывает amount с баланса, открывает раунд.
   * @returns {string} roundId
   * @throws при неверной сумме, выходе за лимиты игры или нехватке средств.
   */
  function placeBet(gameId, amount) {
    if (typeof gameId !== 'string' || !gameId) {
      throw makeError('Не указана игра для ставки', 'INVALID_GAME');
    }
    amount = Number(amount);
    if (!isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
      throw makeError('Ставка должна быть целым положительным числом', 'INVALID_BET');
    }

    var limits = getLimits(gameId);
    if (amount < limits.min) {
      throw makeError('Минимальная ставка: ' + fmt(limits.min), 'BET_TOO_LOW');
    }
    if (amount > limits.max) {
      throw makeError('Максимальная ставка: ' + fmt(limits.max), 'BET_TOO_HIGH');
    }

    var state = load();
    if (state.balance < amount) {
      throw makeError('Недостаточно NB-монет для ставки', 'INSUFFICIENT_FUNDS');
    }

    var roundId = makeRoundId(state.open);
    state.balance -= amount;
    state.open[roundId] = { gameId: gameId, bet: amount, ts: Date.now() };
    save(state); // если запись упадёт (квота) — выбросится ошибка, ничего не списано

    emit('balance:change', {
      balance: state.balance, delta: -amount, reason: 'bet', gameId: gameId, roundId: roundId
    });
    emit('round:started', { roundId: roundId, gameId: gameId, bet: amount });
    return roundId;
  }

  /**
   * Завершить раунд: начислить выплату (сколько вернулось на баланс).
   * Повторный вызов для уже завершённого раунда игнорируется (возвращает false).
   * Для неизвестного roundId бросает ошибку.
   * @returns {object|false} итог раунда либо false при двойном settle
   */
  function settle(roundId, payout, details) {
    if (settledIds[roundId]) {
      console.warn('[Wallet] повторный settle проигнорирован: ' + roundId);
      return false;
    }

    var state = load();
    var round = state.open[roundId];
    if (!round) {
      throw makeError('Раунд не найден или уже закрыт: ' + roundId, 'UNKNOWN_ROUND');
    }

    payout = Number(payout);
    if (!isFinite(payout) || payout < 0) {
      throw makeError('Некорректная выплата', 'INVALID_PAYOUT');
    }
    payout = Math.round(payout);

    // Закрываем раунд и начисляем выплату одной записью
    delete state.open[roundId];
    state.balance = Math.min(state.balance + payout, MAX_BALANCE);
    save(state);
    rememberSettled(roundId);

    var bet = round.bet;
    var result = payout > bet ? 'win' : (payout === bet ? 'push' : 'lose');
    var ts = Date.now();
    var info = {
      roundId: roundId,
      gameId: round.gameId,
      bet: bet,
      payout: payout,
      profit: payout - bet,
      result: result,
      details: details === undefined ? {} : details,
      ts: ts
    };

    // Статистика
    try {
      if (NB.Stats && typeof NB.Stats.recordRound === 'function') {
        NB.Stats.recordRound({
          gameId: round.gameId, bet: bet, payout: payout, details: info.details, ts: ts
        });
      }
    } catch (e) {
      console.error('[Wallet] Stats.recordRound упал', e);
    }

    // Опыт
    try {
      if (NB.Levels && typeof NB.Levels.addXp === 'function') {
        NB.Levels.addXp(calcXp(bet, payout));
      }
    } catch (e) {
      console.error('[Wallet] Levels.addXp упал', e);
    }

    if (payout > 0) {
      emit('balance:change', {
        balance: state.balance, delta: payout, reason: 'payout',
        gameId: round.gameId, roundId: roundId
      });
    }
    emit('round:settled', info);

    // Если игрок на нуле — предложим бонус (с небольшой задержкой для анимаций)
    scheduleBankruptCheck(900);
    return info;
  }

  /**
   * Начислить или списать монеты вне раундов (бонусы, подарки, награды).
   * Отрицательное значение допускается, но баланс не может уйти ниже нуля.
   * @returns {number} новый баланс
   */
  function add(amount, reason) {
    amount = Number(amount);
    if (!isFinite(amount) || amount === 0) {
      throw makeError('Некорректная сумма', 'INVALID_AMOUNT');
    }
    amount = Math.round(amount);

    var state = load();
    if (state.balance + amount < 0) {
      throw makeError('Недостаточно NB-монет', 'INSUFFICIENT_FUNDS');
    }
    state.balance = Math.min(state.balance + amount, MAX_BALANCE);
    save(state);

    emit('balance:change', {
      balance: state.balance, delta: amount, reason: reason || 'add'
    });
    return state.balance;
  }

  /**
   * Отменить открытый раунд и вернуть ставку (например, при аварийном выходе из игры).
   * Статистика не пишется. @returns {boolean} true, если раунд был отменён
   */
  function cancel(roundId, reason) {
    var state = load();
    var round = state.open[roundId];
    if (!round) return false;

    delete state.open[roundId];
    state.balance = Math.min(state.balance + round.bet, MAX_BALANCE);
    save(state);
    rememberSettled(roundId);

    emit('balance:change', {
      balance: state.balance, delta: round.bet, reason: reason || 'refund',
      gameId: round.gameId, roundId: roundId
    });
    emit('round:cancelled', { roundId: roundId, gameId: round.gameId, bet: round.bet });
    scheduleBankruptCheck(900);
    return true;
  }

  /** Список открытых раундов (копия). */
  function getOpenRounds() {
    var open = load().open;
    return Object.keys(open).map(function (id) {
      return { roundId: id, gameId: open[id].gameId, bet: open[id].bet, ts: open[id].ts };
    });
  }

  // ---------------------------------------------------------------------------
  // Банкротский бонус
  // ---------------------------------------------------------------------------

  /** Нужен ли бонус: нет открытых раундов и баланс ниже минимальной ставки. */
  function needsBankruptBonus() {
    var state = load();
    return Object.keys(state.open).length === 0 && state.balance < getGlobalMinBet();
  }

  /** Выдать бонус, если игрок действительно «на мели». @returns {number} сумма бонуса или 0 */
  function claimBankruptBonus() {
    if (!needsBankruptBonus()) return 0;
    var amount = Math.max(BANKRUPT_BONUS, getGlobalMinBet() * 10);
    add(amount, 'bankrupt_bonus');
    try {
      var cnt = Number(NB.Storage.get('nb_bankrupt_count', 0)) || 0;
      NB.Storage.set('nb_bankrupt_count', cnt + 1);
    } catch (e) { /* не критично */ }
    toast('🎁 Банкротский бонус: +' + fmt(amount) + ' NB', 'success');
    emit('wallet:bonus', { amount: amount, reason: 'bankrupt_bonus' });
    return amount;
  }

  /**
   * Проверить банкротство и предложить бонус.
   * @returns {boolean} true, если игрок в состоянии банкротства
   */
  function checkBankrupt() {
    if (bankruptPromptActive || !needsBankruptBonus()) return false;

    var state = load();
    var minBet = getGlobalMinBet();
    emit('wallet:bankrupt', { balance: state.balance, minBet: minBet });

    if (!NB.UI || typeof NB.UI.confirm !== 'function') return true;

    bankruptPromptActive = true;
    var text = 'У вас осталось ' + fmt(state.balance) + ' NB — меньше минимальной ставки (' +
      fmt(minBet) + '). Получить банкротский бонус?';

    Promise.resolve(NB.UI.confirm(text)).then(function (ok) {
      bankruptPromptActive = false;
      if (ok) claimBankruptBonus();
    }).catch(function () {
      bankruptPromptActive = false;
    });
    return true;
  }

  /** Отложенная проверка банкротства (с защитой от дублей). */
  function scheduleBankruptCheck(delay) {
    if (bankruptTimer) clearTimeout(bankruptTimer);
    bankruptTimer = setTimeout(function () {
      bankruptTimer = null;
      checkBankrupt();
    }, delay || 700);
  }

  // ---------------------------------------------------------------------------
  // Восстановление после перезагрузки
  // ---------------------------------------------------------------------------

  /**
   * Если страница была закрыта посреди раунда — результат неизвестен,
   * поэтому ставка возвращается на баланс, а раунд отменяется без статистики.
   */
  function recoverOpenRounds() {
    var state = load();
    var ids = Object.keys(state.open);
    if (!ids.length) return;

    var total = 0;
    var rounds = ids.map(function (id) {
      var r = state.open[id];
      total += r.bet;
      return { roundId: id, gameId: r.gameId, bet: r.bet };
    });

    state.balance = Math.min(state.balance + total, MAX_BALANCE);
    state.open = {};
    save(state);

    emit('balance:change', { balance: state.balance, delta: total, reason: 'refund' });
    emit('wallet:recovered', { count: rounds.length, total: total, rounds: rounds });

    // UI может загрузиться позже — показываем уведомление с задержкой
    setTimeout(function () {
      toast('Незавершённые раунды отменены, ставка возвращена: ' + fmt(total) + ' NB', 'info');
    }, 1200);
  }

  // ---------------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------------

  function init() {
    if (!NB.Storage || typeof NB.Storage.get !== 'function') {
      throw new Error('NB.Wallet: NB.Storage должен быть загружен раньше wallet.js');
    }

    // Первый запуск — создаём кошелёк со стартовым балансом
    if (NB.Storage.get(KEY, null) === null) {
      save(freshState());
    }

    recoverOpenRounds();
    scheduleBankruptCheck(1500); // даём время загрузиться NB.Games и NB.UI
  }

  // ---------------------------------------------------------------------------
  // Экспорт модуля
  // ---------------------------------------------------------------------------

  NB.Wallet = {
    getBalance: getBalance,
    canAfford: canAfford,
    placeBet: placeBet,
    settle: settle,
    add: add,
    // Дополнительные методы (не меняют основной API)
    cancel: cancel,
    getLimits: getLimits,
    getOpenRounds: getOpenRounds,
    checkBankrupt: checkBankrupt,
    claimBankruptBonus: claimBankruptBonus,
    START_BALANCE: START_BALANCE
  };

  init();

})(window);