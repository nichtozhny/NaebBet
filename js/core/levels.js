/* ==========================================================================
   NaebBet — js/core/levels.js
   Модуль NB.Levels: опыт (XP), уровни, звания, награды за уровень.
   Зависимости (все опциональны, используются безопасно):
   NB.Storage, NB.Events, NB.Wallet, NB.UI, NB.Audio
   ========================================================================== */
(function () {
  'use strict';

  var NB = (window.NB = window.NB || {});

  /* ---------------------------- Константы ---------------------------- */

  var STORAGE_KEY = 'nb_levels';   // ключ в хранилище (с префиксом nb_)
  var MAX_LEVEL = 50;              // максимальный уровень
  var MAX_XP_PER_ROUND = 250;      // потолок XP за один раунд
  var MODAL_DELAY = 700;           // задержка показа окна (чтобы не перебивать анимацию игры), мс

  // Звания: с какого уровня начинается звание. Список по возрастанию.
  var TITLES = [
    { from: 1,  title: 'Новичок',        icon: '🐣' },
    { from: 5,  title: 'Игрок',          icon: '🎲' },
    { from: 10, title: 'Азартный',       icon: '🔥' },
    { from: 15, title: 'Хайроллер',      icon: '💎' },
    { from: 20, title: 'Профи',          icon: '🎯' },
    { from: 25, title: 'Шейх',           icon: '🕌' },
    { from: 30, title: 'Магнат',         icon: '🏦' },
    { from: 35, title: 'Барон',          icon: '🎩' },
    { from: 40, title: 'Король казино',  icon: '👑' },
    { from: 45, title: 'Легенда',        icon: '🌟' },
    { from: 50, title: 'Бог удачи',      icon: '⚡' }
  ];

  /* ----------------------- Таблица порогов уровней ----------------------- */

  // XP, необходимый для перехода с уровня L на L+1.
  // Плавный квадратичный рост: быстро в начале, заметно медленнее ближе к концу.
  function xpSpan(level) {
    return Math.round((100 + 40 * level + 12 * level * level) / 10) * 10;
  }

  // THRESHOLDS[L] — суммарный XP, с которого начинается уровень L (L = 1..MAX_LEVEL).
  var THRESHOLDS = [0, 0]; // индекс 0 не используется, уровень 1 начинается с 0 XP
  (function buildThresholds() {
    var sum = 0;
    for (var l = 1; l < MAX_LEVEL; l++) {
      sum += xpSpan(l);
      THRESHOLDS[l + 1] = sum;
    }
  })();

  /* ---------------------------- Состояние ---------------------------- */

  var state = {
    xp: 0,        // суммарный опыт
    claimed: 1    // максимальный уровень, за который награда уже выдана
  };

  var pendingLevelUps = []; // накопленные повышения для единого окна
  var modalTimer = null;

  /* ------------------------- Вспомогательные функции ------------------------- */

  function toInt(n) {
    n = Number(n);
    if (!isFinite(n)) return 0;
    return Math.floor(n);
  }

  // Уровень по суммарному XP (бинарный поиск по порогам)
  function levelFromXp(xp) {
    var lo = 1, hi = MAX_LEVEL;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (THRESHOLDS[mid] <= xp) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function getTitleEntry(level) {
    var found = TITLES[0];
    for (var i = 0; i < TITLES.length; i++) {
      if (TITLES[i].from <= level) found = TITLES[i]; else break;
    }
    return found;
  }

  function getTitle(level) {
    return getTitleEntry(level).title;
  }

  // Награда монетами за достижение уровня
  function getReward(level) {
    if (level < 2) return 0;
    var reward = 200 + level * 100;
    if (level % 10 === 0) reward *= 3;       // круглые уровни — тройной бонус
    else if (level % 5 === 0) reward *= 2;   // каждый пятый — двойной
    if (level === MAX_LEVEL) reward += 25000; // финальный бонус
    return reward;
  }

  function fmt(n) {
    if (NB.UI && typeof NB.UI.formatMoney === 'function') {
      try { return NB.UI.formatMoney(n); } catch (e) { /* упадём на запасной вариант */ }
    }
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /* ----------------------------- Хранилище ----------------------------- */

  function load() {
    var data = null;
    try {
      data = NB.Storage ? NB.Storage.get(STORAGE_KEY, null) : null;
    } catch (e) { data = null; }

    var xp = data && isFinite(data.xp) ? Math.max(0, toInt(data.xp)) : 0;
    var maxXp = THRESHOLDS[MAX_LEVEL];
    if (xp > maxXp) xp = maxXp;

    state.xp = xp;
    var lvl = levelFromXp(xp);
    var claimed = data && isFinite(data.claimed) ? toInt(data.claimed) : lvl;
    state.claimed = Math.min(MAX_LEVEL, Math.max(1, claimed));
    // Если уровень по XP выше выданного — считаем награды как выданные
    // (например, после импорта): повторно за прошлое не платим.
    if (state.claimed < lvl) state.claimed = lvl;
  }

  function save() {
    try {
      if (NB.Storage) NB.Storage.set(STORAGE_KEY, { xp: state.xp, claimed: state.claimed });
    } catch (e) { /* хранилище недоступно — работаем в памяти */ }
  }

  /* ------------------------------ Расчёт XP ------------------------------ */

  // XP за раунд: зависит от суммы ставки и результата.
  function xpForRound(bet, payout) {
    bet = Math.max(0, Number(bet) || 0);
    payout = Math.max(0, Number(payout) || 0);
    if (bet <= 0) return 0;

    var base = 8;
    // Логарифмическая шкала: большие ставки дают больше, но не безгранично
    var betXp = Math.round((Math.log(1 + bet / 50) / Math.LN2) * 6);
    var xp = base + betXp;

    if (payout > bet) {
      xp += Math.round(base * 0.75 + betXp * 0.5); // бонус за победу
      if (payout >= bet * 10) xp += 25;            // крупный выигрыш
      if (payout >= bet * 50) xp += 75;            // джекпот
    } else if (payout === bet) {
      xp += 2;                                     // возврат ставки
    }

    return Math.max(1, Math.min(MAX_XP_PER_ROUND, xp));
  }

  /* ------------------------------ Публичный API ------------------------------ */

  function getInfo() {
    var level = levelFromXp(state.xp);
    var maxed = level >= MAX_LEVEL;
    var start = THRESHOLDS[level];
    var next = maxed ? start : THRESHOLDS[level + 1];
    var span = maxed ? 0 : next - start;
    var into = state.xp - start;
    var entry = getTitleEntry(level);
    return {
      level: level,
      xp: state.xp,                              // суммарный опыт
      xpToNext: maxed ? 0 : next - state.xp,     // сколько осталось до следующего уровня
      title: entry.title,
      // Дополнительные поля для интерфейса (прогресс-бары и т.п.)
      icon: entry.icon,
      levelXp: into,                             // опыт внутри текущего уровня
      levelSpan: span,                           // размер текущего уровня в XP
      nextLevelXp: next,                         // порог следующего уровня (суммарный)
      progress: maxed ? 1 : (span > 0 ? into / span : 0),
      maxed: maxed,
      nextReward: maxed ? 0 : getReward(level + 1),
      maxLevel: MAX_LEVEL
    };
  }

  function addXp(n) {
    n = toInt(n);
    if (n <= 0) return getInfo();

    var oldLevel = levelFromXp(state.xp);
    var maxXp = THRESHOLDS[MAX_LEVEL];
    var oldXp = state.xp;
    state.xp = Math.min(maxXp, state.xp + n);
    var gained = state.xp - oldXp;
    var newLevel = levelFromXp(state.xp);

    if (newLevel > oldLevel) {
      processLevelUps(oldLevel, newLevel);
    }

    save();

    if (NB.Events && gained > 0) {
      NB.Events.emit('xp:change', { delta: gained, xp: state.xp, level: newLevel });
    }
    return getInfo();
  }

  // Начисление наград и события за каждый достигнутый уровень
  function processLevelUps(oldLevel, newLevel) {
    for (var lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
      var reward = 0;
      if (lvl > state.claimed) {
        reward = getReward(lvl);
        state.claimed = lvl;
        if (reward > 0 && NB.Wallet && typeof NB.Wallet.add === 'function') {
          try {
            NB.Wallet.add(reward, 'level_up');
          } catch (e) {
            reward = 0; // награду не удалось выдать — не показываем её в окне
          }
        }
      }

      var prevTitle = getTitle(lvl - 1);
      var curTitle = getTitle(lvl);
      var payload = {
        level: lvl,
        previousLevel: lvl - 1,
        title: curTitle,
        icon: getTitleEntry(lvl).icon,
        titleChanged: prevTitle !== curTitle,
        reward: reward
      };

      pendingLevelUps.push(payload);

      if (NB.Events) {
        try { NB.Events.emit('level:up', payload); } catch (e) { /* подписчик упал — не ломаем остальных */ }
      }
    }
    scheduleModal();
  }

  /* ---------------------------- Окно повышения ---------------------------- */

  function scheduleModal() {
    if (modalTimer) clearTimeout(modalTimer);
    modalTimer = setTimeout(flushModal, MODAL_DELAY);
  }

  function flushModal() {
    modalTimer = null;
    if (!pendingLevelUps.length) return;

    var list = pendingLevelUps.slice();
    pendingLevelUps.length = 0;

    var last = list[list.length - 1];
    var totalReward = 0;
    var titleChanged = false;
    for (var i = 0; i < list.length; i++) {
      totalReward += list[i].reward;
      if (list[i].titleChanged) titleChanged = true;
    }

    if (NB.Audio && typeof NB.Audio.play === 'function') {
      try { NB.Audio.play('bigwin'); } catch (e) { /* звук необязателен */ }
    }

    var info = getInfo();
    var html =
      '<div style="text-align:center;padding:8px 0;">' +
        '<div style="font-size:64px;line-height:1;filter:drop-shadow(0 0 14px #b44cff);">' + last.icon + '</div>' +
        '<div style="margin-top:10px;font-size:14px;letter-spacing:2px;text-transform:uppercase;color:#b44cff;">Новый уровень</div>' +
        '<div style="font-size:56px;font-weight:800;color:#ffd24a;text-shadow:0 0 18px rgba(255,210,74,.65);">' + last.level + '</div>' +
        '<div style="font-size:22px;font-weight:700;color:#fff;">' + last.title + '</div>' +
        (titleChanged
          ? '<div style="margin-top:6px;font-size:14px;color:#ffd24a;">✨ Новое звание!</div>'
          : '') +
        (list.length > 1
          ? '<div style="margin-top:6px;font-size:13px;color:#aaa;">Повышений за раз: ' + list.length + '</div>'
          : '') +
        (totalReward > 0
          ? '<div style="margin:16px auto 0;padding:12px 16px;max-width:260px;border:1px solid #ffd24a;border-radius:14px;' +
            'background:rgba(255,210,74,.08);box-shadow:0 0 16px rgba(255,210,74,.25);">' +
            '<div style="font-size:13px;color:#ccc;">Награда</div>' +
            '<div style="font-size:26px;font-weight:800;color:#ffd24a;">🪙 +' + fmt(totalReward) + '</div>' +
            '</div>'
          : '') +
        (info.maxed
          ? '<div style="margin-top:14px;font-size:13px;color:#aaa;">Максимальный уровень достигнут!</div>'
          : '<div style="margin-top:14px;font-size:13px;color:#aaa;">До следующего уровня: ' + fmt(info.xpToNext) + ' XP</div>') +
      '</div>';

    if (NB.UI && typeof NB.UI.modal === 'function') {
      try {
        NB.UI.modal({
          title: '🎉 Повышение уровня!',
          html: html,
          buttons: [{ text: 'Отлично!', label: 'Отлично!', primary: true, type: 'primary', action: 'close' }]
        });
        return;
      } catch (e) { /* упадём на тост */ }
    }

    if (NB.UI && typeof NB.UI.toast === 'function') {
      NB.UI.toast('Уровень ' + last.level + ': ' + last.title +
        (totalReward > 0 ? ' (+' + fmt(totalReward) + ' монет)' : ''), 'success');
    }
  }

  /* ------------------------- Подписки на события ------------------------- */

  // Раунд завершён: начисляем XP. Формат данных читаем с запасом по именам полей.
  function onRoundSettled(data) {
    if (!data) return;
    var bet = data.bet != null ? data.bet : (data.amount != null ? data.amount : 0);
    var payout = data.payout != null ? data.payout : 0;
    var xp = xpForRound(bet, payout);
    if (xp > 0) addXp(xp);
  }

  // Данные хранилища заменены (импорт/сброс) — перечитываем состояние
  function onStorageReplaced() {
    pendingLevelUps.length = 0;
    load();
  }

  function init() {
    load();
    if (NB.Events) {
      NB.Events.on('round:settled', onRoundSettled);
      NB.Events.on('storage:import', onStorageReplaced);
      NB.Events.on('storage:reset', onStorageReplaced);
    }
  }

  /* ------------------------------ Экспорт модуля ------------------------------ */

  NB.Levels = {
    getInfo: getInfo,
    addXp: addXp,

    // Дополнительные вспомогательные методы
    getTitle: getTitle,
    getReward: getReward,
    getThreshold: function (level) {
      level = Math.min(MAX_LEVEL, Math.max(1, toInt(level)));
      return THRESHOLDS[level];
    },
    xpForRound: xpForRound,
    getTitles: function () {
      return TITLES.map(function (t) { return { from: t.from, title: t.title, icon: t.icon }; });
    },
    reload: onStorageReplaced,
    MAX_LEVEL: MAX_LEVEL
  };

  init();
})();