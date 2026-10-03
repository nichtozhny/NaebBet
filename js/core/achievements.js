/* ============================================================================
 * NaebBet — js/core/achievements.js
 * Модуль NB.Achievements: 40+ достижений, проверка по событию round:settled,
 * награды (NB-монеты + XP), toast, прогресс составных достижений.
 * ========================================================================== */
(function () {
  'use strict';

  var NB = (window.NB = window.NB || {});

  // ------------------------------------------------------------------------
  // Константы
  // ------------------------------------------------------------------------
  var STORAGE_KEY = 'nb_achievements';
  var BANKRUPT_LIMIT = 10;      // баланс ниже этого значения = "банкрот"
  var RETURN_LIMIT = 5000;      // баланс, при котором игрок "вернулся"
  var TOAST_GAP_MS = 1100;      // пауза между toast-ами
  var SEEN_LIMIT = 60;          // сколько последних roundId помним для дедупликации
  var DAYS_LIMIT = 90;          // сколько игровых дней храним

  // ------------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------------
  function safe(fn, def) {
    try {
      var r = fn();
      return r === undefined ? def : r;
    } catch (e) {
      return def;
    }
  }

  function num(v) {
    v = Number(v);
    return isFinite(v) ? v : 0;
  }

  // Берёт первое числовое значение из объекта по списку возможных ключей
  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return 0;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return 0;
  }

  function fmt(n) {
    return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  }

  // Номер локального дня (целое число) — для серий по дням
  function dayNumber(ts) {
    return Math.floor((ts - new Date(ts).getTimezoneOffset() * 60000) / 86400000);
  }

  function freshTracker() {
    return {
      rounds: 0, wins: 0, losses: 0, pushes: 0,
      wagered: 0, paidOut: 0,
      maxBet: 0, maxPayout: 0, maxMult: 0,
      winStreak: 0, bestWinStreak: 0,
      loseStreak: 0, bestLoseStreak: 0,
      games: {},
      bankrupt: false, returned: false,
      nightRounds: 0, earlyRounds: 0,
      days: [], dayNo: 0, dayRounds: 0, maxDayRounds: 0,
      allInWins: 0,
      seen: []
    };
  }

  function freshState() {
    return { v: 1, unlocked: {}, tracker: freshTracker() };
  }

  // ------------------------------------------------------------------------
  // Состояние и хранилище
  // ------------------------------------------------------------------------
  var state = freshState();
  var memoryFallback = null;
  var busy = false;
  var inited = false;
  var toastQueue = [];
  var toastTimer = null;

  function load() {
    var raw = null;
    if (NB.Storage && typeof NB.Storage.get === 'function') {
      raw = safe(function () { return NB.Storage.get(STORAGE_KEY, null); }, null);
    } else {
      raw = memoryFallback;
    }
    var st = freshState();
    if (raw && typeof raw === 'object') {
      if (raw.unlocked && typeof raw.unlocked === 'object') st.unlocked = raw.unlocked;
      if (raw.tracker && typeof raw.tracker === 'object') {
        var base = freshTracker();
        for (var k in base) {
          if (Object.prototype.hasOwnProperty.call(base, k) && raw.tracker[k] !== undefined) {
            base[k] = raw.tracker[k];
          }
        }
        if (!base.games || typeof base.games !== 'object') base.games = {};
        if (!Array.isArray(base.days)) base.days = [];
        if (!Array.isArray(base.seen)) base.seen = [];
        st.tracker = base;
      }
    }
    state = st;
  }

  function save() {
    if (NB.Storage && typeof NB.Storage.set === 'function') {
      safe(function () { NB.Storage.set(STORAGE_KEY, state); });
    } else {
      memoryFallback = JSON.parse(JSON.stringify(state));
    }
  }

  // ------------------------------------------------------------------------
  // Трекер раундов (собственные счётчики; дополняются данными NB.Stats)
  // ------------------------------------------------------------------------
  function trackRound(data) {
    var t = state.tracker;
    var roundId = data && (data.roundId || data.id);

    // Защита от повторной обработки одного и того же раунда
    if (roundId !== undefined && roundId !== null) {
      if (t.seen.indexOf(roundId) !== -1) return false;
      t.seen.push(roundId);
      if (t.seen.length > SEEN_LIMIT) t.seen.shift();
    }

    var bet = num(data && (data.bet !== undefined ? data.bet : data.amount));
    var payout = num(data && data.payout);
    var gameId = data && data.gameId;
    var ts = num(data && data.ts) || Date.now();

    t.rounds++;
    t.wagered += bet;
    t.paidOut += payout;
    if (bet > t.maxBet) t.maxBet = bet;
    if (payout > t.maxPayout) t.maxPayout = payout;

    if (gameId) t.games[gameId] = (t.games[gameId] || 0) + 1;

    if (payout > bet) {
      // Победа
      t.wins++;
      t.winStreak++;
      t.loseStreak = 0;
      if (t.winStreak > t.bestWinStreak) t.bestWinStreak = t.winStreak;
      var mult = bet > 0 ? payout / bet : 0;
      if (mult > t.maxMult) t.maxMult = mult;

      // Ва-банк: ставка была равна всему балансу до ставки
      var balAfter = safe(function () { return NB.Wallet.getBalance(); }, null);
      if (balAfter !== null) {
        var before = num(balAfter) - payout + bet;
        if (bet > 0 && bet >= before) t.allInWins++;
      }
    } else if (payout < bet) {
      // Проигрыш
      t.losses++;
      t.loseStreak++;
      t.winStreak = 0;
      if (t.loseStreak > t.bestLoseStreak) t.bestLoseStreak = t.loseStreak;
    } else {
      // Ничья (возврат ставки) — серии не прерываем
      t.pushes++;
    }

    // Время суток
    var hour = new Date(ts).getHours();
    if (hour < 5) t.nightRounds++;
    else if (hour >= 5 && hour < 8) t.earlyRounds++;

    // Дни игры
    var dn = dayNumber(ts);
    if (t.dayNo !== dn) {
      t.dayNo = dn;
      t.dayRounds = 0;
    }
    t.dayRounds++;
    if (t.dayRounds > t.maxDayRounds) t.maxDayRounds = t.dayRounds;
    if (t.days.indexOf(dn) === -1) {
      t.days.push(dn);
      t.days.sort(function (a, b) { return a - b; });
      if (t.days.length > DAYS_LIMIT) t.days.shift();
    }

    updateBankruptFlags();
    return true;
  }

  // Обновляет флаги "банкрот" и "вернулся". Возвращает true, если что-то изменилось
  function updateBankruptFlags() {
    var t = state.tracker;
    var bal = safe(function () { return NB.Wallet.getBalance(); }, null);
    if (bal === null) return false;
    bal = num(bal);
    var changed = false;
    if (!t.bankrupt && bal < BANKRUPT_LIMIT) {
      t.bankrupt = true;
      changed = true;
    } else if (t.bankrupt && !t.returned && bal >= RETURN_LIMIT) {
      t.returned = true;
      changed = true;
    }
    return changed;
  }

  function bestDayStreak(days) {
    var best = 0, cur = 0, prev = null;
    for (var i = 0; i < days.length; i++) {
      if (prev !== null && days[i] === prev + 1) cur++;
      else cur = 1;
      if (cur > best) best = cur;
      prev = days[i];
    }
    return best;
  }

  // ------------------------------------------------------------------------
  // Контекст для условий: данные NB.Stats + собственный трекер
  // ------------------------------------------------------------------------
  function buildCtx() {
    var t = state.tracker;
    var g = safe(function () { return NB.Stats.getGlobal(); }, null) || {};
    var st = safe(function () { return NB.Stats.getStreaks(); }, null) || {};

    var games = safe(function () { return NB.Games.getAll(); }, []) || [];
    var played = 0;
    for (var i = 0; i < games.length; i++) {
      var id = games[i] && games[i].id;
      var cnt = num(t.games[id]);
      if (!cnt) {
        var gs = safe(function () { return NB.Stats.getGame(id); }, null);
        cnt = pick(gs, ['rounds', 'totalRounds', 'roundsPlayed', 'count']);
      }
      if (cnt > 0) played++;
    }

    var lvl = safe(function () { return NB.Levels.getInfo(); }, null);

    return {
      rounds: Math.max(t.rounds, pick(g, ['totalRounds', 'rounds', 'roundsPlayed', 'count'])),
      wins: Math.max(t.wins, pick(g, ['wins', 'totalWins', 'winCount'])),
      wagered: Math.max(t.wagered, pick(g, ['totalBet', 'totalWagered', 'wagered'])),
      paidOut: Math.max(t.paidOut, pick(g, ['totalPayout', 'totalWon', 'paidOut'])),
      maxBet: Math.max(t.maxBet, pick(g, ['maxBet', 'biggestBet'])),
      maxPayout: Math.max(t.maxPayout, pick(g, ['maxPayout', 'biggestWin', 'maxWin'])),
      maxMult: Math.max(t.maxMult, pick(g, ['maxMultiplier', 'bestMultiplier'])),
      winStreak: t.winStreak,
      bestWinStreak: Math.max(t.bestWinStreak, pick(st, ['bestWin', 'bestWinStreak', 'maxWin', 'longestWin'])),
      bestLoseStreak: Math.max(t.bestLoseStreak, pick(st, ['bestLose', 'bestLoseStreak', 'maxLose', 'longestLose'])),
      pushes: t.pushes,
      gamesPlayed: played,
      gamesTotal: games.length,
      balance: num(safe(function () { return NB.Wallet.getBalance(); }, 0)),
      level: lvl ? num(lvl.level) : 1,
      bankrupt: !!t.bankrupt,
      returned: !!t.returned,
      nightRounds: t.nightRounds,
      earlyRounds: t.earlyRounds,
      dayStreak: bestDayStreak(t.days),
      maxDayRounds: t.maxDayRounds,
      allInWins: t.allInWins,
      unlockedCount: Object.keys(state.unlocked).length
    };
  }

  // ------------------------------------------------------------------------
  // Каталог достижений
  // ------------------------------------------------------------------------
  var LIST = [];

  // Простое достижение с произвольным условием и прогрессом
  function def(o) {
    LIST.push(o);
  }

  // Счётчик: ctx[key] >= target, прогресс считается автоматически
  function counter(id, icon, name, desc, key, target, reward, xp, cat, secret) {
    def({
      id: id, icon: icon, name: name, desc: desc, cat: cat,
      reward: reward, xp: xp, secret: !!secret,
      condition: function (c) { return c[key] >= target; },
      progress: function (c) { return { cur: Math.min(c[key], target), max: target }; }
    });
  }

  // --- Раунды ---
  counter('first_round', '🎲', 'Первый шаг', 'Сыграйте свой первый раунд', 'rounds', 1, 100, 10, 'Игра');
  counter('rounds_100', '🎯', 'Втянулся', 'Сыграйте 100 раундов', 'rounds', 100, 500, 40, 'Игра');
  counter('rounds_500', '🎰', 'Завсегдатай', 'Сыграйте 500 раундов', 'rounds', 500, 1500, 100, 'Игра');
  counter('rounds_1000', '🏛️', 'Постоянный гость', 'Сыграйте 1000 раундов', 'rounds', 1000, 3000, 200, 'Игра');
  counter('rounds_5000', '👑', 'Король казино', 'Сыграйте 5000 раундов', 'rounds', 5000, 10000, 600, 'Игра');

  // --- Победы ---
  counter('first_win', '🏆', 'Первая победа', 'Выиграйте свой первый раунд', 'wins', 1, 200, 20, 'Победы');
  counter('wins_10', '🥉', 'Десятка', 'Одержите 10 побед', 'wins', 10, 400, 40, 'Победы');
  counter('wins_50', '🥈', 'Полтинник', 'Одержите 50 побед', 'wins', 50, 1000, 80, 'Победы');
  counter('wins_100', '🥇', 'Сотка', 'Одержите 100 побед', 'wins', 100, 2500, 150, 'Победы');
  counter('wins_500', '💎', 'Мастер побед', 'Одержите 500 побед', 'wins', 500, 8000, 400, 'Победы');

  // --- Серии побед ---
  counter('streak_3', '🔥', 'Разогрев', 'Выиграйте 3 раунда подряд', 'bestWinStreak', 3, 300, 30, 'Серии');
  counter('streak_5', '⚡', 'На волне', 'Выиграйте 5 раундов подряд', 'bestWinStreak', 5, 800, 70, 'Серии');
  counter('streak_10', '🌋', 'Неудержимый', 'Выиграйте 10 раундов подряд', 'bestWinStreak', 10, 3000, 200, 'Серии');
  counter('streak_15', '☄️', 'Легенда серий', 'Выиграйте 15 раундов подряд', 'bestWinStreak', 15, 7500, 400, 'Серии');

  // --- Серии поражений (утешительные) ---
  counter('lose_5', '🌧️', 'Не повезло', 'Проиграйте 5 раундов подряд', 'bestLoseStreak', 5, 250, 20, 'Серии');
  counter('lose_10', '🌪️', 'Чёрная полоса', 'Проиграйте 10 раундов подряд', 'bestLoseStreak', 10, 1000, 60, 'Серии');

  // --- Крупные ставки ---
  counter('bet_1000', '💵', 'Серьёзная ставка', 'Сделайте ставку 1000 монет', 'maxBet', 1000, 300, 30, 'Ставки');
  counter('bet_5000', '💰', 'Крупный игрок', 'Сделайте ставку 5000 монет', 'maxBet', 5000, 1000, 80, 'Ставки');
  counter('bet_10000', '🤑', 'Хайроллер', 'Сделайте ставку 10000 монет', 'maxBet', 10000, 3000, 200, 'Ставки');

  // --- Множители выигрыша ---
  counter('mult_10', '✨', 'Иксы пошли', 'Выиграйте с множителем x10', 'maxMult', 10, 500, 50, 'Выигрыши');
  counter('mult_50', '🌟', 'Жирный куш', 'Выиграйте с множителем x50', 'maxMult', 50, 2000, 150, 'Выигрыши');
  counter('mult_100', '💥', 'Сотка иксов', 'Выиграйте с множителем x100', 'maxMult', 100, 5000, 300, 'Выигрыши');
  counter('mult_500', '🚀', 'Космический иск', 'Выиграйте с множителем x500', 'maxMult', 500, 20000, 800, 'Выигрыши');

  // --- Крупные выплаты ---
  counter('payout_50k', '🏦', 'Крупный выигрыш', 'Получите выплату от 50 000 монет за раунд', 'maxPayout', 50000, 2500, 150, 'Выигрыши');
  counter('payout_250k', '🏰', 'Джекпот', 'Получите выплату от 250 000 монет за раунд', 'maxPayout', 250000, 12000, 500, 'Выигрыши');

  // --- Разнообразие игр (составные: прогресс по играм) ---
  def({
    id: 'games_3', icon: '🎮', name: 'Любопытный', desc: 'Попробуйте 3 разные игры', cat: 'Игра',
    reward: 600, xp: 50, secret: false,
    condition: function (c) { return c.gamesPlayed >= 3; },
    progress: function (c) { return { cur: Math.min(c.gamesPlayed, 3), max: 3 }; }
  });
  def({
    id: 'all_games', icon: '🗺️', name: 'Коллекционер игр', desc: 'Сыграйте во все игры казино', cat: 'Игра',
    reward: 5000, xp: 300, secret: false,
    condition: function (c) { return c.gamesTotal > 0 && c.gamesPlayed >= c.gamesTotal; },
    progress: function (c) {
      var max = Math.max(c.gamesTotal, 1);
      return { cur: Math.min(c.gamesPlayed, max), max: max };
    }
  });

  // --- Банкрот и возвращение (составное: 2 шага) ---
  def({
    id: 'bankrupt_return', icon: '🦅', name: 'Феникс', cat: 'Особые',
    desc: 'Станьте банкротом, а затем вернитесь к балансу 5000+ монет',
    reward: 3000, xp: 250, secret: false,
    condition: function (c) { return c.bankrupt && c.returned; },
    progress: function (c) {
      return { cur: (c.bankrupt ? 1 : 0) + (c.returned ? 1 : 0), max: 2 };
    }
  });

  // --- Время суток ---
  def({
    id: 'night_owl', icon: '🦉', name: 'Ночной игрок', cat: 'Особые',
    desc: 'Сыграйте 10 раундов ночью (с 00:00 до 05:00)',
    reward: 1000, xp: 80, secret: false,
    condition: function (c) { return c.nightRounds >= 10; },
    progress: function (c) { return { cur: Math.min(c.nightRounds, 10), max: 10 }; }
  });
  def({
    id: 'early_bird', icon: '🐦', name: 'Ранняя пташка', cat: 'Особые',
    desc: 'Сыграйте 10 раундов утром (с 05:00 до 08:00)',
    reward: 1000, xp: 80, secret: false,
    condition: function (c) { return c.earlyRounds >= 10; },
    progress: function (c) { return { cur: Math.min(c.earlyRounds, 10), max: 10 }; }
  });

  // --- Объём ставок и выплат ---
  counter('wagered_100k', '📈', 'Оборот 100K', 'Поставьте суммарно 100 000 монет', 'wagered', 100000, 1500, 100, 'Экономика');
  counter('wagered_1m', '📊', 'Оборот 1M', 'Поставьте суммарно 1 000 000 монет', 'wagered', 1000000, 10000, 400, 'Экономика');
  counter('paid_100k', '💸', 'Получатель 100K', 'Получите выплат на 100 000 монет', 'paidOut', 100000, 1500, 100, 'Экономика');
  counter('paid_1m', '🪙', 'Получатель 1M', 'Получите выплат на 1 000 000 монет', 'paidOut', 1000000, 10000, 400, 'Экономика');

  // --- Баланс ---
  counter('balance_25k', '🧰', 'Запасливый', 'Накопите 25 000 монет на балансе', 'balance', 25000, 1000, 80, 'Экономика');
  counter('balance_100k', '🏧', 'Богач', 'Накопите 100 000 монет на балансе', 'balance', 100000, 5000, 250, 'Экономика');
  counter('balance_1m', '🛳️', 'Миллионер', 'Накопите 1 000 000 монет на балансе', 'balance', 1000000, 25000, 800, 'Экономика');

  // --- Уровни ---
  counter('level_5', '⭐', 'Уровень 5', 'Достигните 5 уровня', 'level', 5, 1000, 0, 'Прогресс');
  counter('level_10', '🌠', 'Уровень 10', 'Достигните 10 уровня', 'level', 10, 3000, 0, 'Прогресс');

  // --- Игровые дни ---
  counter('days_3', '📅', 'Три дня подряд', 'Играйте 3 дня подряд', 'dayStreak', 3, 800, 60, 'Прогресс');
  counter('days_7', '🗓️', 'Неделя в игре', 'Играйте 7 дней подряд', 'dayStreak', 7, 3000, 200, 'Прогресс');

  // --- Особые ---
  counter('all_in_win', '🎢', 'Ва-банк!', 'Выиграйте, поставив весь баланс', 'allInWins', 1, 2000, 150, 'Особые');
  counter('push_3', '🤝', 'Миротворец', 'Сыграйте вничью (возврат ставки) 3 раза', 'pushes', 3, 300, 30, 'Особые');
  counter('day_rounds_50', '⏱️', 'Марафонец', 'Сыграйте 50 раундов за один день', 'maxDayRounds', 50, 1500, 100, 'Особые');

  // --- Мета-достижения ---
  counter('collector_10', '🧩', 'Охотник за наградами', 'Откройте 10 достижений', 'unlockedCount', 10, 2000, 150, 'Прогресс');
  counter('collector_25', '🏅', 'Коллекционер', 'Откройте 25 достижений', 'unlockedCount', 25, 7500, 400, 'Прогресс');
  counter('collector_40', '🎖️', 'Абсолютный чемпион', 'Откройте 40 достижений', 'unlockedCount', 40, 20000, 1000, 'Прогресс');

  // Индекс по id
  var BY_ID = {};
  for (var li = 0; li < LIST.length; li++) BY_ID[LIST[li].id] = LIST[li];

  // ------------------------------------------------------------------------
  // Публичное представление достижения
  // ------------------------------------------------------------------------
  function describe(a, ctx) {
    var unlockedAt = state.unlocked[a.id] || null;
    var p = safe(function () { return a.progress(ctx); }, { cur: 0, max: 1 });
    if (unlockedAt) p = { cur: p.max, max: p.max };
    var pct = p.max > 0 ? Math.min(100, Math.floor((p.cur / p.max) * 100)) : 0;
    var hidden = a.secret && !unlockedAt;
    return {
      id: a.id,
      name: hidden ? '???' : a.name,
      description: hidden ? 'Секретное достижение' : a.desc,
      icon: hidden ? '❓' : a.icon,
      category: a.cat,
      reward: a.reward,
      xp: a.xp,
      secret: a.secret,
      unlocked: !!unlockedAt,
      unlockedAt: unlockedAt,
      progress: { cur: p.cur, max: p.max, pct: pct }
    };
  }

  // ------------------------------------------------------------------------
  // Toast-очередь (чтобы несколько достижений не перекрывали друг друга)
  // ------------------------------------------------------------------------
  function pumpToasts() {
    if (toastTimer || !toastQueue.length) return;
    var a = toastQueue.shift();
    var text = a.icon + ' Достижение: ' + a.name + ' — +' + fmt(a.reward) + ' NB';
    if (NB.UI && typeof NB.UI.toast === 'function') {
      safe(function () { NB.UI.toast(text, 'success'); });
    }
    if (NB.Audio && typeof NB.Audio.play === 'function') {
      safe(function () { NB.Audio.play('bigwin'); });
    }
    toastTimer = setTimeout(function () {
      toastTimer = null;
      pumpToasts();
    }, TOAST_GAP_MS);
  }

  // ------------------------------------------------------------------------
  // Разблокировка и проверка
  // ------------------------------------------------------------------------
  function unlock(a) {
    state.unlocked[a.id] = Date.now();
    save(); // сохраняем до выдачи награды, чтобы не выдать её дважды

    if (a.reward > 0 && NB.Wallet && typeof NB.Wallet.add === 'function') {
      safe(function () { NB.Wallet.add(a.reward, 'achievement:' + a.id); });
    }
    if (a.xp > 0 && NB.Levels && typeof NB.Levels.addXp === 'function') {
      safe(function () { NB.Levels.addXp(a.xp); });
    }

    var info = {
      id: a.id, name: a.name, description: a.desc, icon: a.icon,
      category: a.cat, reward: a.reward, xp: a.xp, ts: state.unlocked[a.id]
    };
    if (NB.Events && typeof NB.Events.emit === 'function') {
      safe(function () { NB.Events.emit('achievement:unlocked', info); });
    }
    toastQueue.push(info);
    pumpToasts();
  }

  // Проверяет все ещё не открытые достижения. Возвращает список новых.
  function check() {
    if (busy) return [];
    busy = true;
    var newly = [];
    try {
      var again = true;
      var guard = 0;
      while (again && guard++ < 10) {
        again = false;
        var ctx = buildCtx();
        for (var i = 0; i < LIST.length; i++) {
          var a = LIST[i];
          if (state.unlocked[a.id]) continue;
          var ok = false;
          try { ok = !!a.condition(ctx); } catch (e) { ok = false; }
          if (ok) {
            unlock(a);
            newly.push(describe(a, ctx));
            again = true; // мета-достижения и баланс могли измениться
            break;        // пересобираем контекст
          }
        }
      }
    } finally {
      busy = false;
    }
    if (newly.length) save();
    return newly;
  }

  // ------------------------------------------------------------------------
  // Обработчики событий
  // ------------------------------------------------------------------------
  function onRoundSettled(data) {
    var isNew = trackRound(data || {});
    if (isNew) save();
    // Откладываем проверку, чтобы NB.Stats успел записать раунд
    setTimeout(check, 0);
  }

  function onBalanceChange() {
    if (busy) return;
    if (updateBankruptFlags()) {
      save();
      setTimeout(check, 0);
    }
  }

  function onReset() {
    load();
    updateBankruptFlags();
  }

  function init() {
    if (inited) return;
    if (!NB.Events || typeof NB.Events.on !== 'function') return;
    inited = true;
    load();
    NB.Events.on('round:settled', onRoundSettled);
    NB.Events.on('balance:change', onBalanceChange);
    NB.Events.on('storage:reset', onReset);
    NB.Events.on('storage:import', onReset);
    // Первичная проверка после загрузки всех модулей
    setTimeout(function () {
      updateBankruptFlags();
      check();
    }, 300);
  }

  // ------------------------------------------------------------------------
  // Публичный API
  // ------------------------------------------------------------------------
  NB.Achievements = {
    // Принудительная проверка всех достижений; возвращает массив новых
    check: function () {
      if (!inited) init();
      return check();
    },

    // Все достижения с состоянием и прогрессом
    getAll: function () {
      var ctx = buildCtx();
      var out = [];
      for (var i = 0; i < LIST.length; i++) out.push(describe(LIST[i], ctx));
      return out;
    },

    // Только открытые, от новых к старым
    getUnlocked: function () {
      var ctx = buildCtx();
      var out = [];
      for (var i = 0; i < LIST.length; i++) {
        if (state.unlocked[LIST[i].id]) out.push(describe(LIST[i], ctx));
      }
      out.sort(function (a, b) { return b.unlockedAt - a.unlockedAt; });
      return out;
    }
  };

  // Запуск: сразу, если события уже доступны, иначе после загрузки страницы
  if (NB.Events) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('load', init);
  }
})();