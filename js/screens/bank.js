/* ==========================================================================
   NaebBet — js/screens/bank.js
   Экран «Банк»: баланс, ежедневный бонус, бесплатное колесо, банкротский бонус,
   история пополнений, магазин косметики (темы, аватары, рамки).
   Применяет выбранную тему через CSS-переменные (--nb-*).
   Дополнительно публикует NB.Bank (getEquipped, avatarHTML, applyTheme, ...).
   ========================================================================== */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};

  /* ------------------------------------------------------------------------
     Константы
     ------------------------------------------------------------------------ */
  var KEY = 'nb_bank';
  var SCHEMA = 1;

  var DAILY_REWARDS = [500, 750, 1000, 1500, 2000, 3000, 5000]; // цикл из 7 дней
  var WHEEL_COOLDOWN = 4 * 60 * 60 * 1000;                      // 4 часа
  var BANKRUPT_THRESHOLD = 100;                                 // баланс ниже этого — «банкрот»
  var BANKRUPT_AMOUNT = 1000;
  var BANKRUPT_COOLDOWN = 15 * 60 * 1000;                       // 15 минут
  var HISTORY_LIMIT = 50;
  var HISTORY_SHOW = 20;

  // Сегменты колеса (порядок — по часовой стрелке, начиная сверху)
  var WHEEL_SEGMENTS = [
    { amount: 50,   weight: 30 },
    { amount: 500,  weight: 4  },
    { amount: 100,  weight: 25 },
    { amount: 250,  weight: 8  },
    { amount: 150,  weight: 18 },
    { amount: 1000, weight: 2  },
    { amount: 200,  weight: 12 },
    { amount: 2500, weight: 1  }
  ];

  /* ------------------------------------------------------------------------
     Каталог косметики
     ------------------------------------------------------------------------ */
  var THEMES = [
    { id: 'neon', name: 'Неон-фиолет', price: 0, vars: {
      bg: '#0b0614', surface: '#161028', surface2: '#1f1638', text: '#f3eeff', muted: '#9a8fbf',
      accent: '#a855f7', accent2: '#d946ef', gold: '#fbbf24', border: '#2e2250', felt: '#1a0f33' } },
    { id: 'goldrush', name: 'Золотая лихорадка', price: 3000, vars: {
      bg: '#0d0a02', surface: '#1a1405', surface2: '#251c08', text: '#fff7e0', muted: '#b8a46a',
      accent: '#fbbf24', accent2: '#f59e0b', gold: '#ffd700', border: '#3d2f0c', felt: '#1f1706' } },
    { id: 'cyber', name: 'Кибер-синий', price: 3000, vars: {
      bg: '#040b17', surface: '#0a1626', surface2: '#10213a', text: '#e6f6ff', muted: '#7ea2bd',
      accent: '#22d3ee', accent2: '#3b82f6', gold: '#fbbf24', border: '#173553', felt: '#0b1d33' } },
    { id: 'emerald', name: 'Изумрудное сукно', price: 5000, vars: {
      bg: '#03110b', surface: '#08201a', surface2: '#0d2c23', text: '#e8fff4', muted: '#7bb59c',
      accent: '#10b981', accent2: '#34d399', gold: '#fbbf24', border: '#12493a', felt: '#0a3a2a' } },
    { id: 'crimson', name: 'Багровая ночь', price: 5000, vars: {
      bg: '#14040a', surface: '#240912', surface2: '#330e1b', text: '#ffeef2', muted: '#c08a98',
      accent: '#f43f5e', accent2: '#fb7185', gold: '#fbbf24', border: '#4d1425', felt: '#2d0b17' } },
    { id: 'sunset', name: 'Закат в Вегасе', price: 8000, vars: {
      bg: '#12060f', surface: '#220c1c', surface2: '#2f1328', text: '#fff0f5', muted: '#c797ad',
      accent: '#fb7185', accent2: '#f59e0b', gold: '#fcd34d', border: '#4a1d3a', felt: '#2a0f24' } },
    { id: 'blackice', name: 'Чёрный лёд', price: 12000, vars: {
      bg: '#000000', surface: '#0c0c0e', surface2: '#16161a', text: '#f4f4f5', muted: '#8b8b95',
      accent: '#e5e7eb', accent2: '#9ca3af', gold: '#fbbf24', border: '#26262c', felt: '#101012' } }
  ];

  var AVATARS = [
    { id: '🎰', name: 'Однорукий', price: 0 },
    { id: '🍀', name: 'Клевер', price: 1000 },
    { id: '🃏', name: 'Джокер', price: 500 },
    { id: '🎲', name: 'Кости', price: 500 },
    { id: '🦊', name: 'Хитрый лис', price: 1500 },
    { id: '💎', name: 'Бриллиант', price: 1500 },
    { id: '🤖', name: 'Бот', price: 2500 },
    { id: '🐉', name: 'Дракон', price: 3000 },
    { id: '👑', name: 'Корона', price: 5000 },
    { id: '🚀', name: 'Ракета', price: 5000 },
    { id: '🦄', name: 'Единорог', price: 8000 },
    { id: '😈', name: 'Дьявол', price: 8000 }
  ];

  var FRAMES = [
    { id: 'none', name: 'Без рамки', price: 0, bg: 'transparent', shadow: 'none', cls: '' },
    { id: 'violet', name: 'Фиолетовая', price: 1000,
      bg: 'linear-gradient(135deg,#a855f7,#6d28d9)', shadow: '0 0 12px rgba(168,85,247,.7)', cls: '' },
    { id: 'gold', name: 'Золотая', price: 2500,
      bg: 'linear-gradient(135deg,#fde68a,#f59e0b,#b45309)', shadow: '0 0 14px rgba(251,191,36,.7)', cls: '' },
    { id: 'pulse', name: 'Неоновый пульс', price: 4000,
      bg: 'linear-gradient(135deg,#22d3ee,#d946ef)', shadow: '0 0 14px rgba(217,70,239,.8)', cls: 'bk-pulse' },
    { id: 'rainbow', name: 'Радужная', price: 6000,
      bg: 'conic-gradient(#f43f5e,#fbbf24,#10b981,#22d3ee,#a855f7,#f43f5e)', shadow: '0 0 14px rgba(255,255,255,.35)', cls: '' },
    { id: 'fire', name: 'Огненная', price: 8000,
      bg: 'linear-gradient(135deg,#fde047,#f97316,#dc2626)', shadow: '0 0 16px rgba(249,115,22,.85)', cls: 'bk-pulse' },
    { id: 'diamond', name: 'Алмазная', price: 12000,
      bg: 'linear-gradient(135deg,#ffffff,#a5f3fc,#c4b5fd,#ffffff)', shadow: '0 0 18px rgba(165,243,252,.9)', cls: 'bk-pulse' }
  ];

  var CATALOG = { themes: THEMES, avatars: AVATARS, frames: FRAMES };
  var CAT_TITLES = { themes: 'Темы', avatars: 'Аватары', frames: 'Рамки' };

  function findItem(cat, id) {
    var list = CATALOG[cat] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ------------------------------------------------------------------------
     Безопасные обёртки над другими модулями
     ------------------------------------------------------------------------ */
  function sfx(name) { try { if (NB.Audio) NB.Audio.play(name); } catch (e) { /* звук не критичен */ } }
  function toast(text, type) { try { if (NB.UI) NB.UI.toast(text, type || 'info'); } catch (e) { /* ignore */ } }
  function fmt(n) {
    try { if (NB.UI && NB.UI.formatMoney) return NB.UI.formatMoney(n); } catch (e) { /* ignore */ }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function emit(name, data) { try { if (NB.Events) NB.Events.emit(name, data); } catch (e) { /* ignore */ } }
  function balance() { try { return NB.Wallet.getBalance(); } catch (e) { return 0; } }

  /* ------------------------------------------------------------------------
     Состояние (хранится в NB.Storage)
     ------------------------------------------------------------------------ */
  function defaultState() {
    return {
      v: SCHEMA,
      lastDaily: -1,        // индекс дня последнего получения бонуса
      streak: 0,
      lastWheel: 0,
      pendingWheel: 0,      // приз колеса, ещё не зачисленный (защита от перезагрузки)
      lastBankrupt: 0,
      history: [],
      owned: { themes: ['neon'], avatars: ['🎰'], frames: ['none'] },
      equipped: { theme: 'neon', avatar: '🎰', frame: 'none' }
    };
  }

  function loadState() {
    var def = defaultState();
    var raw = null;
    try { raw = NB.Storage.get(KEY, null); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') return def;

    var s = def;
    // Миграции схемы (на будущее): сейчас v1
    s.lastDaily = typeof raw.lastDaily === 'number' ? raw.lastDaily : -1;
    s.streak = Math.max(0, raw.streak | 0);
    s.lastWheel = +raw.lastWheel || 0;
    s.pendingWheel = Math.max(0, +raw.pendingWheel || 0);
    s.lastBankrupt = +raw.lastBankrupt || 0;
    s.history = Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_LIMIT) : [];

    ['themes', 'avatars', 'frames'].forEach(function (cat) {
      var arr = raw.owned && Array.isArray(raw.owned[cat]) ? raw.owned[cat] : [];
      arr.forEach(function (id) {
        if (findItem(cat, id) && s.owned[cat].indexOf(id) < 0) s.owned[cat].push(id);
      });
    });
    var eq = raw.equipped || {};
    s.equipped.theme = validEquip('themes', eq.theme, 'neon', s);
    s.equipped.avatar = validEquip('avatars', eq.avatar, '🎰', s);
    s.equipped.frame = validEquip('frames', eq.frame, 'none', s);
    return s;
  }

  function validEquip(cat, id, fallback, s) {
    return (findItem(cat, id) && s.owned[cat].indexOf(id) >= 0) ? id : fallback;
  }

  var state = loadState();

  function save() {
    try { NB.Storage.set(KEY, state); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------------
     Тема: применение через CSS-переменные
     ------------------------------------------------------------------------ */
  function applyTheme(id) {
    var theme = findItem('themes', id) || THEMES[0];
    var root = document.documentElement;
    var v = theme.vars;
    var map = {
      '--nb-bg': v.bg, '--nb-surface': v.surface, '--nb-surface2': v.surface2,
      '--nb-text': v.text, '--nb-muted': v.muted, '--nb-accent': v.accent,
      '--nb-accent2': v.accent2, '--nb-gold': v.gold, '--nb-border': v.border,
      '--nb-felt': v.felt, '--nb-glow': v.accent + '88',
      // короткие алиасы для общего CSS
      '--bg': v.bg, '--surface': v.surface, '--text': v.text,
      '--accent': v.accent, '--gold': v.gold, '--border': v.border
    };
    Object.keys(map).forEach(function (k) { root.style.setProperty(k, map[k]); });
    root.setAttribute('data-theme', theme.id);

    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', v.bg);
    } catch (e) { /* ignore */ }
    emit('theme:change', { id: theme.id });
  }

  // Применяем сохранённую тему сразу при загрузке скрипта
  applyTheme(state.equipped.theme);

  /* ------------------------------------------------------------------------
     Аватар + рамка (HTML-строка, можно использовать в других экранах)
     ------------------------------------------------------------------------ */
  function avatarHTML(size, avatarId, frameId) {
    size = size || 56;
    var av = findItem('avatars', avatarId || state.equipped.avatar) || AVATARS[0];
    var fr = findItem('frames', frameId || state.equipped.frame) || FRAMES[0];
    var pad = fr.id === 'none' ? 0 : Math.max(3, Math.round(size / 16));
    var inner = size - pad * 2;
    return '<span class="bk-av ' + fr.cls + '" style="width:' + size + 'px;height:' + size +
      'px;padding:' + pad + 'px;background:' + fr.bg + ';box-shadow:' + fr.shadow + '">' +
      '<span class="bk-av-in" style="width:' + inner + 'px;height:' + inner + 'px;font-size:' +
      Math.round(inner * 0.58) + 'px">' + av.id + '</span></span>';
  }

  /* ------------------------------------------------------------------------
     Время
     ------------------------------------------------------------------------ */
  function dayIndex(ts) {
    return Math.floor((ts - new Date(ts).getTimezoneOffset() * 60000) / 86400000);
  }
  function msToMidnight(now) {
    var d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - now;
  }
  function fmtDur(ms) {
    ms = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(ms / 3600), m = Math.floor((ms % 3600) / 60), s = ms % 60;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return (h > 0 ? h + ':' : '') + p(m) + ':' + p(s);
  }
  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
  }

  /* ------------------------------------------------------------------------
     Зачисление бонусов и история пополнений
     ------------------------------------------------------------------------ */
  var HIST_META = {
    daily:    { icon: '🎁', label: 'Ежедневный бонус' },
    wheel:    { icon: '🎡', label: 'Бесплатное колесо' },
    bankrupt: { icon: '🆘', label: 'Банкротский бонус' }
  };

  function grant(amount, type) {
    try {
      NB.Wallet.add(amount, 'bank:' + type);
    } catch (e) {
      toast('Не удалось начислить монеты', 'error');
      return false;
    }
    state.history.unshift({ ts: Date.now(), type: type, amount: amount });
    if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
    save();
    emit('bank:grant', { type: type, amount: amount });
    return true;
  }

  function addXp(n) { try { if (NB.Levels) NB.Levels.addXp(n); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------------
     Статусы бонусов
     ------------------------------------------------------------------------ */
  function dailyStatus(now) {
    var today = dayIndex(now);
    var claimed = state.lastDaily >= today; // в т.ч. защита от отката часов назад
    var cont = state.lastDaily === today - 1;
    var next = claimed ? state.streak : (cont ? state.streak + 1 : 1);
    var idx = (Math.max(1, next) - 1) % DAILY_REWARDS.length;
    var done;
    if (claimed) done = ((state.streak - 1) % DAILY_REWARDS.length) + 1;
    else done = (cont ? state.streak : 0) % DAILY_REWARDS.length;
    return {
      available: !claimed,
      next: next,
      amount: DAILY_REWARDS[idx],
      done: Math.max(0, done),
      wait: claimed ? msToMidnight(now) : 0
    };
  }

  function wheelStatus(now) {
    var wait = Math.min(WHEEL_COOLDOWN, state.lastWheel + WHEEL_COOLDOWN - now);
    return { available: wait <= 0, wait: Math.max(0, wait) };
  }

  function bankruptStatus(now) {
    var wait = Math.min(BANKRUPT_COOLDOWN, state.lastBankrupt + BANKRUPT_COOLDOWN - now);
    var poor = balance() < BANKRUPT_THRESHOLD;
    return { poor: poor, wait: Math.max(0, wait), available: poor && wait <= 0 };
  }

  /* ------------------------------------------------------------------------
     Стили (внедряются один раз)
     ------------------------------------------------------------------------ */
  function injectStyles() {
    if (document.getElementById('nb-bank-style')) return;
    var css = [
      '.bk{padding:12px 12px 32px;color:var(--nb-text,#f3eeff);font-family:inherit;max-width:520px;margin:0 auto;box-sizing:border-box}',
      '.bk *{box-sizing:border-box}',
      '.bk-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}',
      '.bk-back{min-width:44px;min-height:44px;border-radius:12px;border:1px solid var(--nb-border,#2e2250);background:var(--nb-surface,#161028);color:var(--nb-text,#f3eeff);font-size:20px;cursor:pointer}',
      '.bk-title{font-size:22px;font-weight:800;margin:0;letter-spacing:.5px}',
      '.bk-card{background:linear-gradient(160deg,var(--nb-surface,#161028),var(--nb-surface2,#1f1638));border:1px solid var(--nb-border,#2e2250);border-radius:18px;padding:14px;margin-bottom:14px;box-shadow:0 0 18px rgba(0,0,0,.35)}',
      '.bk-h{margin:0 0 10px;font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}',
      '.bk-muted{color:var(--nb-muted,#9a8fbf);font-size:13px}',
      '.bk-profile{display:flex;align-items:center;gap:14px}',
      '.bk-bal-label{font-size:12px;color:var(--nb-muted,#9a8fbf);text-transform:uppercase;letter-spacing:1px}',
      '.bk-bal{font-size:30px;font-weight:900;color:var(--nb-gold,#fbbf24);text-shadow:0 0 14px rgba(251,191,36,.45);line-height:1.15}',
      '.bk-lvl{font-size:13px;color:var(--nb-muted,#9a8fbf)}',
      '.bk-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;flex:none}',
      '.bk-av-in{display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--nb-surface,#161028)}',
      '.bk-pulse{animation:bkPulse 1.8s ease-in-out infinite}',
      '@keyframes bkPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}',
      '.bk-btn{display:block;width:100%;min-height:48px;padding:12px 16px;border:0;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;color:#1a1033;background:linear-gradient(135deg,var(--nb-gold,#fbbf24),#f59e0b);box-shadow:0 0 14px rgba(251,191,36,.35);-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
      '.bk-btn:active{transform:scale(.97)}',
      '.bk-btn.alt{color:#fff;background:linear-gradient(135deg,var(--nb-accent,#a855f7),var(--nb-accent2,#d946ef));box-shadow:0 0 14px var(--nb-glow,#a855f788)}',
      '.bk-btn.red{color:#fff;background:linear-gradient(135deg,#f43f5e,#be123c);box-shadow:0 0 14px rgba(244,63,94,.4)}',
      '.bk-btn[disabled]{opacity:.45;cursor:default;box-shadow:none;transform:none;filter:grayscale(.4)}',
      '.bk-days{display:flex;gap:6px;margin:4px 0 12px}',
      '.bk-day{flex:1;text-align:center;padding:6px 0;border-radius:10px;border:1px solid var(--nb-border,#2e2250);background:var(--nb-bg,#0b0614);font-size:11px;color:var(--nb-muted,#9a8fbf)}',
      '.bk-day b{display:block;font-size:12px;color:var(--nb-text,#f3eeff)}',
      '.bk-day.done{border-color:var(--nb-gold,#fbbf24);background:rgba(251,191,36,.15)}',
      '.bk-day.done b{color:var(--nb-gold,#fbbf24)}',
      '.bk-day.now{border-color:var(--nb-accent,#a855f7);box-shadow:0 0 10px var(--nb-glow,#a855f788)}',
      '.bk-wheel-wrap{position:relative;width:260px;height:260px;margin:6px auto 14px}',
      '.bk-wheel-wrap canvas{width:260px;height:260px;display:block}',
      '.bk-pointer{position:absolute;left:50%;top:-6px;margin-left:-14px;width:0;height:0;border-left:14px solid transparent;border-right:14px solid transparent;border-top:26px solid var(--nb-gold,#fbbf24);filter:drop-shadow(0 0 6px rgba(251,191,36,.8));z-index:2}',
      '.bk-hist{list-style:none;margin:0;padding:0}',
      '.bk-hist li{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--nb-border,#2e2250)}',
      '.bk-hist li:last-child{border-bottom:0}',
      '.bk-hist .ic{font-size:22px;width:32px;text-align:center}',
      '.bk-hist .tx{flex:1;min-width:0}',
      '.bk-hist .tx div:first-child{font-size:14px;font-weight:600}',
      '.bk-hist .am{font-weight:800;color:#34d399;white-space:nowrap}',
      '.bk-tabs{display:flex;gap:6px;margin-bottom:12px}',
      '.bk-tab{flex:1;min-height:44px;border-radius:12px;border:1px solid var(--nb-border,#2e2250);background:var(--nb-bg,#0b0614);color:var(--nb-muted,#9a8fbf);font-size:14px;font-weight:700;cursor:pointer}',
      '.bk-tab.on{color:#fff;border-color:var(--nb-accent,#a855f7);background:linear-gradient(135deg,var(--nb-accent,#a855f7),var(--nb-accent2,#d946ef));box-shadow:0 0 12px var(--nb-glow,#a855f788)}',
      '.bk-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.bk-item{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 8px;border-radius:14px;border:1px solid var(--nb-border,#2e2250);background:var(--nb-bg,#0b0614);text-align:center}',
      '.bk-item.eq{border-color:var(--nb-gold,#fbbf24);box-shadow:0 0 10px rgba(251,191,36,.3)}',
      '.bk-item .nm{font-size:13px;font-weight:700;min-height:32px;display:flex;align-items:center}',
      '.bk-item .bk-btn{min-height:44px;font-size:14px;padding:8px 6px}',
      '.bk-swatch{width:100%;height:56px;border-radius:12px;border:1px solid rgba(255,255,255,.12);position:relative;overflow:hidden}',
      '.bk-swatch i{position:absolute;bottom:8px;height:10px;border-radius:5px}',
      '.bk-empty{text-align:center;padding:14px 0}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'nb-bank-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------------
     Экран
     ------------------------------------------------------------------------ */
  var ui = null;            // ссылки на DOM текущего монтирования
  var root = null;          // контейнер экрана
  var timerId = null;       // секундный таймер
  var rafId = 0;            // requestAnimationFrame колеса
  var spinning = false;
  var wheelRot = 0;         // текущий угол колеса (рад)
  var shownBalance = 0;
  var shopTab = 'themes';
  var evHandlers = [];      // подписки на NB.Events для снятия при unmount
  var dpr = 1;

  function on(name, fn) {
    try { NB.Events.on(name, fn); evHandlers.push([name, fn]); } catch (e) { /* ignore */ }
  }

  function buildHTML() {
    return [
      '<div class="bk">',
      '  <div class="bk-top">',
      '    <button class="bk-back" data-action="back" aria-label="Назад">←</button>',
      '    <h2 class="bk-title">🏦 Банк</h2>',
      '  </div>',
      '  <div class="bk-card">',
      '    <div class="bk-profile">',
      '      <div id="bk-avatar"></div>',
      '      <div>',
      '        <div class="bk-bal-label">Баланс NB-монет</div>',
      '        <div class="bk-bal" id="bk-balance">0</div>',
      '        <div class="bk-lvl" id="bk-level"></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="bk-card">',
      '    <h3 class="bk-h">🎁 Ежедневный бонус</h3>',
      '    <div class="bk-days" id="bk-days"></div>',
      '    <div class="bk-muted" id="bk-daily-info" style="margin-bottom:10px"></div>',
      '    <button class="bk-btn" id="bk-daily-btn" data-action="daily">Забрать</button>',
      '  </div>',
      '  <div class="bk-card">',
      '    <h3 class="bk-h">🎡 Бесплатное колесо</h3>',
      '    <div class="bk-wheel-wrap"><div class="bk-pointer"></div><canvas id="bk-canvas" width="260" height="260"></canvas></div>',
      '    <div class="bk-muted" id="bk-wheel-info" style="margin-bottom:10px;text-align:center"></div>',
      '    <button class="bk-btn alt" id="bk-wheel-btn" data-action="spin">Крутить</button>',
      '  </div>',
      '  <div class="bk-card">',
      '    <h3 class="bk-h">🆘 Банкротский бонус</h3>',
      '    <div class="bk-muted" id="bk-bank-info" style="margin-bottom:10px"></div>',
      '    <button class="bk-btn red" id="bk-bank-btn" data-action="bankrupt">Получить помощь</button>',
      '  </div>',
      '  <div class="bk-card">',
      '    <h3 class="bk-h">🛍️ Магазин</h3>',
      '    <div class="bk-tabs" id="bk-tabs"></div>',
      '    <div class="bk-grid" id="bk-shop"></div>',
      '  </div>',
      '  <div class="bk-card">',
      '    <h3 class="bk-h">📜 История пополнений</h3>',
      '    <ul class="bk-hist" id="bk-hist"></ul>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ---- Баланс и профиль ---- */
  function updateBalance(animate) {
    var b = balance();
    if (!ui) return;
    if (animate && NB.UI && NB.UI.animateNumber && b !== shownBalance) {
      try { NB.UI.animateNumber(ui.balance, shownBalance, b, 600); } catch (e) { ui.balance.textContent = fmt(b); }
    } else {
      ui.balance.textContent = fmt(b);
    }
    shownBalance = b;
  }

  function renderProfile() {
    if (!ui) return;
    ui.avatar.innerHTML = avatarHTML(72);
    var txt = '';
    try {
      if (NB.Levels) {
        var li = NB.Levels.getInfo();
        txt = 'Уровень ' + li.level + (li.title ? ' · ' + li.title : '');
      }
    } catch (e) { txt = ''; }
    ui.level.textContent = txt;
  }

  /* ---- Дни ежедневного бонуса ---- */
  function renderDays(st) {
    var html = '';
    for (var i = 0; i < DAILY_REWARDS.length; i++) {
      var cls = 'bk-day';
      if (i < st.done) cls += ' done';
      else if (i === st.done && st.available) cls += ' now';
      html += '<div class="' + cls + '">' + (i + 1) + 'д<b>' + fmt(DAILY_REWARDS[i]) + '</b></div>';
    }
    ui.days.innerHTML = html;
  }

  /* ---- Обновление динамических частей (раз в секунду) ---- */
  function tick() {
    if (!ui) return;
    var now = Date.now();

    var d = dailyStatus(now);
    renderDays(d);
    if (d.available) {
      ui.dailyInfo.textContent = 'День серии: ' + d.next + '. Награда: ' + fmt(d.amount) + ' NB';
      ui.dailyBtn.disabled = false;
      ui.dailyBtn.textContent = '🎁 Забрать ' + fmt(d.amount);
    } else {
      ui.dailyInfo.textContent = 'Серия: ' + state.streak + ' дн. Следующий бонус — через ' + fmtDur(d.wait);
      ui.dailyBtn.disabled = true;
      ui.dailyBtn.textContent = 'Уже получено сегодня';
    }

    var w = wheelStatus(now);
    if (spinning) {
      ui.wheelInfo.textContent = 'Колесо крутится…';
      ui.wheelBtn.disabled = true;
    } else if (w.available) {
      ui.wheelInfo.textContent = 'Приз от ' + fmt(WHEEL_SEGMENTS[0].amount) + ' до ' + fmt(2500) + ' NB';
      ui.wheelBtn.disabled = false;
      ui.wheelBtn.textContent = '🎡 Крутить бесплатно';
    } else {
      ui.wheelInfo.textContent = 'Следующая попытка через ' + fmtDur(w.wait);
      ui.wheelBtn.disabled = true;
      ui.wheelBtn.textContent = 'Колесо отдыхает';
    }

    var b = bankruptStatus(now);
    if (b.available) {
      ui.bankInfo.textContent = 'Монеты на исходе! Мы поможем: +' + fmt(BANKRUPT_AMOUNT) + ' NB.';
      ui.bankBtn.disabled = false;
      ui.bankBtn.textContent = '🆘 Получить ' + fmt(BANKRUPT_AMOUNT);
    } else if (b.poor) {
      ui.bankInfo.textContent = 'Следующая помощь через ' + fmtDur(b.wait);
      ui.bankBtn.disabled = true;
      ui.bankBtn.textContent = 'Подождите немного';
    } else {
      ui.bankInfo.textContent = 'Доступно, когда баланс ниже ' + fmt(BANKRUPT_THRESHOLD) + ' NB.';
      ui.bankBtn.disabled = true;
      ui.bankBtn.textContent = 'Пока не нужно';
    }
  }

  /* ---- История ---- */
  function renderHistory() {
    if (!ui) return;
    if (!state.history.length) {
      ui.hist.innerHTML = '<li class="bk-empty bk-muted" style="display:block">Пополнений пока не было. Заберите ежедневный бонус!</li>';
      return;
    }
    var html = '';
    state.history.slice(0, HISTORY_SHOW).forEach(function (h) {
      var m = HIST_META[h.type] || { icon: '💰', label: 'Пополнение' };
      html += '<li><div class="ic">' + m.icon + '</div><div class="tx"><div>' + m.label +
        '</div><div class="bk-muted">' + fmtDate(h.ts) + '</div></div><div class="am">+' + fmt(h.amount) + '</div></li>';
    });
    ui.hist.innerHTML = html;
  }

  /* ---- Магазин ---- */
  function renderTabs() {
    var html = '';
    Object.keys(CAT_TITLES).forEach(function (cat) {
      html += '<button class="bk-tab' + (cat === shopTab ? ' on' : '') + '" data-action="tab" data-cat="' + cat + '">' +
        CAT_TITLES[cat] + '</button>';
    });
    ui.tabs.innerHTML = html;
  }

  function previewHTML(cat, item) {
    if (cat === 'themes') {
      var v = item.vars;
      return '<div class="bk-swatch" style="background:' + v.bg + '">' +
        '<i style="left:8px;width:34%;background:' + v.accent + '"></i>' +
        '<i style="left:42%;width:20%;background:' + v.gold + '"></i>' +
        '<i style="left:66%;width:26%;background:' + v.surface2 + '"></i></div>';
    }
    if (cat === 'avatars') return avatarHTML(56, item.id, state.equipped.frame);
    return avatarHTML(56, state.equipped.avatar, item.id);
  }

  function equippedKey(cat) { return cat === 'themes' ? 'theme' : (cat === 'avatars' ? 'avatar' : 'frame'); }

  function renderShop() {
    if (!ui) return;
    renderTabs();
    var cat = shopTab;
    var eqId = state.equipped[equippedKey(cat)];
    var bal = balance();
    var html = '';
    CATALOG[cat].forEach(function (item) {
      var owned = state.owned[cat].indexOf(item.id) >= 0;
      var isEq = eqId === item.id;
      var btn;
      if (isEq) {
        btn = '<button class="bk-btn alt" disabled>✔ Надето</button>';
      } else if (owned) {
        btn = '<button class="bk-btn alt" data-action="equip" data-cat="' + cat + '" data-id="' + item.id + '">Надеть</button>';
      } else {
        var poor = bal < item.price;
        btn = '<button class="bk-btn' + (poor ? ' bk-poor' : '') + '" data-action="buy" data-cat="' + cat +
          '" data-id="' + item.id + '"' + (poor ? ' style="opacity:.6"' : '') + '>💰 ' + fmt(item.price) + '</button>';
      }
      html += '<div class="bk-item' + (isEq ? ' eq' : '') + '">' + previewHTML(cat, item) +
        '<div class="nm">' + item.name + '</div>' + btn + '</div>';
    });
    ui.shop.innerHTML = html;
  }

  /* ---- Колесо (Canvas) ---- */
  function cssVar(cs, name, fallback) {
    var v = cs.getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function drawWheel() {
    if (!ui || !ui.canvas) return;
    var c = ui.canvas, ctx = c.getContext('2d');
    var S = 260, R = S / 2 - 6;
    var cs = getComputedStyle(document.documentElement);
    var accent = cssVar(cs, '--nb-accent', '#a855f7');
    var surf2 = cssVar(cs, '--nb-surface2', '#1f1638');
    var gold = cssVar(cs, '--nb-gold', '#fbbf24');
    var text = cssVar(cs, '--nb-text', '#f3eeff');
    var bg = cssVar(cs, '--nb-bg', '#0b0614');
    var n = WHEEL_SEGMENTS.length, seg = Math.PI * 2 / n;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(wheelRot);

    for (var i = 0; i < n; i++) {
      var a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
      var big = WHEEL_SEGMENTS[i].amount >= 1000;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = big ? gold : (i % 2 ? surf2 : accent);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = bg;
      ctx.stroke();

      ctx.save();
      ctx.rotate(a0 + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillStyle = big ? '#1a1033' : text;
      ctx.fillText(String(WHEEL_SEGMENTS[i].amount), R - 14, 0);
      ctx.restore();
    }

    // Внешний ободок и ступица
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = gold;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = gold;
    ctx.stroke();
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = gold;
    ctx.fillText('★', 0, 1);
    ctx.restore();
  }

  function setupCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ui.canvas.width = Math.round(260 * dpr);
    ui.canvas.height = Math.round(260 * dpr);
    drawWheel();
  }

  function segUnderPointer(rot) {
    var full = Math.PI * 2;
    var a = ((-rot % full) + full) % full;
    return Math.floor(a / (full / WHEEL_SEGMENTS.length)) % WHEEL_SEGMENTS.length;
  }

  function finishSpin(prize) {
    spinning = false;
    rafId = 0;
    if (state.pendingWheel > 0) {
      if (grant(prize, 'wheel')) {
        state.pendingWheel = 0;
        save();
        addXp(5);
        sfx(prize >= 500 ? 'bigwin' : 'win');
        toast('Колесо подарило ' + fmt(prize) + ' NB! 🎉', 'success');
      }
    }
    renderHistory();
    renderShop();
    renderProfile();
    tick();
  }

  function spin() {
    var now = Date.now();
    if (spinning || !wheelStatus(now).available) return;

    var idxs = WHEEL_SEGMENTS.map(function (_, i) { return i; });
    var weights = WHEEL_SEGMENTS.map(function (s) { return s.weight; });
    var idx = NB.RNG.weighted(idxs, weights);
    var prize = WHEEL_SEGMENTS[idx].amount;

    // Фиксируем результат ДО анимации, чтобы перезагрузка страницы не дала повторную попытку
    state.lastWheel = now;
    state.pendingWheel = prize;
    save();

    var full = Math.PI * 2, seg = full / WHEEL_SEGMENTS.length;
    var jitter = (NB.RNG.float() - 0.5) * seg * 0.7;
    var desired = -((idx + 0.5) * seg) + jitter;
    var finalMod = ((desired % full) + full) % full;
    var baseMod = ((wheelRot % full) + full) % full;
    var delta = ((finalMod - baseMod) + full) % full + full * (5 + NB.RNG.int(0, 2));

    var start = wheelRot, end = wheelRot + delta;
    var dur = 4500, t0 = performance.now();
    var lastSeg = segUnderPointer(start);

    spinning = true;
    sfx('spin');
    tick();

    function frame(t) {
      if (!spinning || !ui) return;
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      wheelRot = start + (end - start) * e;
      var s = segUnderPointer(wheelRot);
      if (s !== lastSeg) { lastSeg = s; sfx('tick'); }
      drawWheel();
      if (p < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        wheelRot = end;
        drawWheel();
        finishSpin(prize);
      }
    }
    rafId = requestAnimationFrame(frame);
  }

  /* ---- Действия ---- */
  function claimDaily() {
    var now = Date.now();
    var d = dailyStatus(now);
    if (!d.available) return;
    state.lastDaily = dayIndex(now);
    state.streak = d.next;
    if (grant(d.amount, 'daily')) {
      addXp(10);
      sfx(d.amount >= 3000 ? 'bigwin' : 'coin');
      toast('Ежедневный бонус: +' + fmt(d.amount) + ' NB 🎁', 'success');
    } else {
      // откат при ошибке начисления
      state = loadState();
    }
    renderHistory();
    renderShop();
    tick();
  }

  function claimBankrupt() {
    var st = bankruptStatus(Date.now());
    if (!st.available) {
      sfx('error');
      return;
    }
    state.lastBankrupt = Date.now();
    if (grant(BANKRUPT_AMOUNT, 'bankrupt')) {
      sfx('coin');
      toast('Банк выдал вам ' + fmt(BANKRUPT_AMOUNT) + ' NB. Удачи! 🍀', 'success');
    } else {
      state = loadState();
    }
    renderHistory();
    renderShop();
    tick();
  }

  function equip(cat, id) {
    if (state.owned[cat].indexOf(id) < 0) return;
    state.equipped[equippedKey(cat)] = id;
    save();
    if (cat === 'themes') applyTheme(id);
    sfx('click');
    renderProfile();
    renderShop();
    emit('profile:change', { equipped: NB.Bank.getEquipped() });
  }

  function buy(cat, id) {
    var item = findItem(cat, id);
    if (!item || state.owned[cat].indexOf(id) >= 0) return;

    var proceed = function () {
      var ok;
      try { ok = NB.Wallet.canAfford(item.price); } catch (e) { ok = false; }
      if (!ok) {
        sfx('error');
        toast('Не хватает монет на «' + item.name + '»', 'error');
        return;
      }
      try {
        NB.Wallet.add(-item.price, 'shop:' + cat + ':' + id);
      } catch (e) {
        sfx('error');
        toast('Покупка не удалась', 'error');
        return;
      }
      state.owned[cat].push(id);
      state.equipped[equippedKey(cat)] = id;
      save();
      if (cat === 'themes') applyTheme(id);
      sfx('coin');
      addXp(Math.max(5, Math.round(item.price / 500)));
      toast('Куплено: ' + item.name + ' ✨', 'success');
      renderProfile();
      renderShop();
      emit('shop:purchase', { cat: cat, id: id, price: item.price });
      emit('profile:change', { equipped: NB.Bank.getEquipped() });
    };

    if (balance() < item.price) {
      sfx('error');
      toast('Не хватает ' + fmt(item.price - balance()) + ' NB', 'error');
      return;
    }

    var q = 'Купить «' + item.name + '» за ' + fmt(item.price) + ' NB?';
    try {
      NB.UI.confirm(q).then(function (yes) { if (yes && ui) proceed(); });
    } catch (e) {
      proceed();
    }
  }

  function onClick(ev) {
    var el = ev.target;
    while (el && el !== root && !(el.getAttribute && el.getAttribute('data-action'))) el = el.parentNode;
    if (!el || el === root || el.disabled) return;
    var a = el.getAttribute('data-action');
    if (a === 'back') { sfx('click'); try { NB.Router.back(); } catch (e) { /* ignore */ } }
    else if (a === 'daily') claimDaily();
    else if (a === 'spin') spin();
    else if (a === 'bankrupt') claimBankrupt();
    else if (a === 'tab') { shopTab = el.getAttribute('data-cat'); sfx('click'); renderShop(); }
    else if (a === 'equip') equip(el.getAttribute('data-cat'), el.getAttribute('data-id'));
    else if (a === 'buy') buy(el.getAttribute('data-cat'), el.getAttribute('data-id'));
  }

  /* ---- mount / unmount ---- */
  function mount(container) {
    unmount(); // на случай повторного монтирования
    injectStyles();
    state = loadState(); // актуализируем (мог быть импорт/сброс данных)
    applyTheme(state.equipped.theme);

    root = container;
    root.innerHTML = buildHTML();
    ui = {
      balance: root.querySelector('#bk-balance'),
      level: root.querySelector('#bk-level'),
      avatar: root.querySelector('#bk-avatar'),
      days: root.querySelector('#bk-days'),
      dailyInfo: root.querySelector('#bk-daily-info'),
      dailyBtn: root.querySelector('#bk-daily-btn'),
      canvas: root.querySelector('#bk-canvas'),
      wheelInfo: root.querySelector('#bk-wheel-info'),
      wheelBtn: root.querySelector('#bk-wheel-btn'),
      bankInfo: root.querySelector('#bk-bank-info'),
      bankBtn: root.querySelector('#bk-bank-btn'),
      tabs: root.querySelector('#bk-tabs'),
      shop: root.querySelector('#bk-shop'),
      hist: root.querySelector('#bk-hist')
    };

    root.addEventListener('click', onClick);

    // Восстановление незачисленного приза колеса (если страницу закрыли во время вращения)
    if (state.pendingWheel > 0) {
      var p = state.pendingWheel;
      if (grant(p, 'wheel')) {
        state.pendingWheel = 0;
        save();
        toast('Приз колеса зачислен: +' + fmt(p) + ' NB', 'success');
      }
    }

    shownBalance = balance();
    ui.balance.textContent = fmt(shownBalance);
    renderProfile();
    setupCanvas();
    renderShop();
    renderHistory();
    tick();

    on('balance:change', function () {
      updateBalance(true);
      renderShop();
      tick();
    });
    on('theme:change', function () { drawWheel(); });

    timerId = setInterval(tick, 1000);
  }

  function unmount() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // Если колесо крутилось и экран закрыли — приз уже сохранён в pendingWheel и будет зачислен при следующем входе
    spinning = false;
    evHandlers.forEach(function (h) {
      try { NB.Events.off(h[0], h[1]); } catch (e) { /* ignore */ }
    });
    evHandlers = [];
    if (root) {
      root.removeEventListener('click', onClick);
      root.innerHTML = '';
    }
    root = null;
    ui = null;
  }

  /* ------------------------------------------------------------------------
     Публичный API модуля
     ------------------------------------------------------------------------ */
  NB.Bank = {
    // Текущая экипировка: { theme, avatar, frame }
    getEquipped: function () {
      return { theme: state.equipped.theme, avatar: state.equipped.avatar, frame: state.equipped.frame };
    },
    // HTML аватара с рамкой для других экранов
    avatarHTML: function (size) { return avatarHTML(size); },
    // Применить тему (например, после импорта данных)
    applyTheme: function (id) { applyTheme(id || state.equipped.theme); },
    // Перечитать состояние из хранилища и применить тему
    reload: function () { state = loadState(); applyTheme(state.equipped.theme); },
    // Каталог (копия для чтения)
    getCatalog: function () {
      return {
        themes: THEMES.map(function (t) { return { id: t.id, name: t.name, price: t.price }; }),
        avatars: AVATARS.map(function (a) { return { id: a.id, name: a.name, price: a.price }; }),
        frames: FRAMES.map(function (f) { return { id: f.id, name: f.name, price: f.price }; })
      };
    },
    isOwned: function (cat, id) { return !!state.owned[cat] && state.owned[cat].indexOf(id) >= 0; }
  };

  if (NB.Router && NB.Router.register) {
    NB.Router.register('bank', { mount: mount, unmount: unmount });
  }
})();