/* ==========================================================================
 * NaebBet — js/main.js
 * Точка входа: инициализация модулей, регистрация экранов, тема, заставка,
 * первый запуск (имя + тур), бонусы, лобби, визуальная пауза при скрытии вкладки.
 *
 * Подключать ПОСЛЕДНИМ скриптом (после всех модулей NB.* и всех игр).
 *
 * Договорённости по «склейке» модулей (делается здесь, на событии "round:settled"):
 *   - NB.Stats.recordRound(...)  — вызывается отсюда (отключается NB.Main.config.glueStats = false,
 *     если Wallet/Stats уже связаны между собой);
 *   - NB.Levels.addXp(...)       — начисление опыта за раунд;
 *   - NB.Achievements.check()    — проверка достижений.
 * Ожидаемые данные события: {roundId, gameId, bet, payout, details}.
 * ========================================================================== */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};
  var doc = document;

  /* ------------------------------------------------------------------------
   * Константы и конфигурация
   * ---------------------------------------------------------------------- */
  var VERSION = '1.0.0';

  var K = {
    PLAYER: 'nb_player',          // {name, created}
    THEME: 'nb_theme',            // 'violet' | 'gold'
    FIRST_RUN: 'nb_first_run_done',
    BONUS: 'nb_bonus',            // {lastDaily, streak, lastRescue}
    VOLUME: 'nb_volume',          // 0..1
    AUTOPAUSE: 'nb_tmp_autopause' // служебный флаг: звук заглушён из-за скрытия вкладки
  };

  var CONFIG = {
    glueStats: true,        // писать раунды в NB.Stats отсюда
    splashMinMs: 1500,      // минимальная длительность заставки
    dailyBase: 1000,        // базовый ежедневный бонус
    dailyStep: 500,         // прибавка за каждый день серии
    dailyMaxSteps: 6,       // максимум шагов серии
    rescueAmount: 1000,     // «спасательный» бонус при банкротстве
    rescueCooldownMs: 2 * 60 * 1000
  };

  var DAY = 24 * 60 * 60 * 1000;

  var THEMES = {
    violet: { name: 'Неон-фиолет', color: '#0b0714' },
    gold: { name: 'Золото', color: '#0f0b04' }
  };

  // Модули в порядке инициализации. req=true — без модуля приложение не запустится.
  var MODULES = [
    { n: 'Events', req: true },
    { n: 'Storage', req: true },
    { n: 'RNG', req: true },
    { n: 'Audio', req: false },
    { n: 'UI', req: true },
    { n: 'Wallet', req: true },
    { n: 'Stats', req: false },
    { n: 'Levels', req: false },
    { n: 'Achievements', req: false },
    { n: 'Rules', req: false },
    { n: 'Games', req: true },
    { n: 'Router', req: true }
  ];

  var TOUR = [
    { ico: '🎰', t: 'Добро пожаловать в NaebBet',
      d: 'Это виртуальное казино. NB-монеты — игровые, реальных денег здесь нет, вывести или купить ничего нельзя. Всё работает офлайн.' },
    { ico: '🪙', t: 'Баланс и ставки',
      d: 'Баланс всегда виден сверху. Перед каждым раундом выбери ставку — кнопками или быстрыми множителями.' },
    { ico: '📖', t: 'Правила игр',
      d: 'В каждой игре есть кнопка «📖» — там цель, выплаты, советы и ответы на частые вопросы.' },
    { ico: '⭐', t: 'Уровни и достижения',
      d: 'За каждый раунд ты получаешь опыт. Растут уровни, открываются достижения — смотри их во вкладке «Награды».' },
    { ico: '🎁', t: 'Бонусы',
      d: 'Заходи каждый день за бонусом — чем длиннее серия, тем он больше. Если монеты закончились, приложение поможет.' },
    { ico: '⚙️', t: 'Настройки и сохранения',
      d: 'Звук, тема, имя и экспорт/импорт прогресса — во вкладке «Ещё». Удачи за столами!' }
  ];

  var state = {
    booted: false,
    paused: false,
    autoMuted: false,
    dialogs: 0,
    bonusBusy: false,
    splash: null,
    pauseEl: null,
    filter: 'all',
    histFilter: 'all',
    activeGame: null,
    seenRounds: {},
    seenOrder: [],
    announced: {},
    lastErrToast: 0
  };

  /* ------------------------------------------------------------------------
   * Утилиты
   * ---------------------------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function h(tag, cls, html) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function warn() {
    if (window.console && console.warn) {
      var a = Array.prototype.slice.call(arguments);
      a.unshift('[NB.Main]');
      console.warn.apply(console, a);
    }
  }

  function safe(fn, def) {
    try { return fn(); } catch (e) { warn(e); return def; }
  }

  function fmt(n) {
    try { return NB.UI.formatMoney(n); } catch (e) { return String(Math.round(+n || 0)); }
  }

  function sfx(name) {
    try { if (NB.Audio) NB.Audio.play(name); } catch (e) { /* звук не критичен */ }
  }

  function toast(text, type) {
    try { NB.UI.toast(text, type || 'info'); } catch (e) { /* UI может быть недоступен */ }
  }

  function emit(name, data) {
    try { NB.Events.emit(name, data); } catch (e) { warn(e); }
  }

  function sGet(key, def) {
    try { return NB.Storage.get(key, def); } catch (e) { return def; }
  }

  function sSet(key, val) {
    try { NB.Storage.set(key, val); } catch (e) { warn(e); }
  }

  function sRemove(key) {
    try { NB.Storage.remove(key); } catch (e) { warn(e); }
  }

  function balance() {
    return safe(function () { return NB.Wallet.getBalance(); }, 0);
  }

  // Первое числовое поле из списка возможных имён (устойчивость к форме данных Stats)
  function firstNum(obj, keys) {
    if (obj == null) return null;
    if (typeof obj === 'number') return obj;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return null;
  }

  function safeGames() {
    var a = safe(function () { return NB.Games.getAll(); }, []);
    if (Array.isArray(a)) return a;
    if (a && typeof a === 'object') {
      return Object.keys(a).map(function (k) { return a[k]; });
    }
    return [];
  }

  function gameById(id) {
    return safe(function () { return NB.Games.get(id); }, null);
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  function fmtRtp(r) {
    var n = +r;
    if (!isFinite(n) || n <= 0) return '';
    if (n <= 1) n = n * 100;
    return 'RTP ' + (Math.round(n * 10) / 10) + '%';
  }

  /* ------------------------------------------------------------------------
   * Стили (инъекция, чтобы main.js не зависел от внешних CSS)
   * ---------------------------------------------------------------------- */
  var CSS = [
    ':root{--m-bg:#0b0714;--m-bg2:#150d26;--m-card:#1b1230;--m-card2:#261a49;--m-line:rgba(180,107,255,.28);',
    '--m-text:#f3ecff;--m-dim:#a99ac7;--m-accent:#b46bff;--m-accent2:#ffcf4a;--m-good:#3ee08f;--m-bad:#ff5c7a;',
    '--m-glow:0 0 14px rgba(180,107,255,.55)}',
    ':root[data-theme="gold"]{--m-bg:#0f0b04;--m-bg2:#1a1307;--m-card:#231a0a;--m-card2:#33250e;--m-line:rgba(255,207,74,.3);',
    '--m-accent:#ffcf4a;--m-accent2:#b46bff;--m-glow:0 0 14px rgba(255,207,74,.5)}',
    'html,body{margin:0;min-height:100%;background:var(--m-bg);color:var(--m-text);',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent;',
    'overscroll-behavior:none;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-text-size-adjust:100%}',
    'input,textarea{-webkit-user-select:text;user-select:text;font-family:inherit}',
    '#app{min-height:100vh;min-height:100dvh}',
    'body.nb-paused *{animation-play-state:paused!important}',
    '.nb-m-page{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;',
    'background:radial-gradient(120% 60% at 50% 0%,var(--m-bg2),var(--m-bg) 70%)}',
    '.nb-m-top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:8px;',
    'padding:calc(8px + env(safe-area-inset-top)) 12px 8px;background:rgba(11,7,20,.93);',
    '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-bottom:1px solid var(--m-line)}',
    '.nb-m-title{flex:1;min-width:0;font-size:18px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.nb-m-title.logo{font-size:22px;letter-spacing:.5px;background:linear-gradient(90deg,var(--m-accent),var(--m-accent2));',
    '-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 0 6px rgba(180,107,255,.5))}',
    '.nb-m-btn{min-height:44px;min-width:44px;box-sizing:border-box;border:1px solid var(--m-line);border-radius:12px;',
    'background:var(--m-card2);color:var(--m-text);font-size:16px;font-weight:700;padding:0 14px;cursor:pointer;font-family:inherit}',
    '.nb-m-btn:active{transform:scale(.97)}',
    '.nb-m-btn.primary{background:linear-gradient(135deg,var(--m-accent),#7b3fe4);border:none;color:#fff;box-shadow:var(--m-glow)}',
    '.nb-m-btn.gold{background:linear-gradient(135deg,#ffe28a,#ffb800);border:none;color:#2a1d00;box-shadow:0 0 14px rgba(255,200,60,.45)}',
    '.nb-m-btn.danger{background:#4a1223;border-color:var(--m-bad);color:#ffb3c1}',
    '.nb-m-btn.ghost{background:transparent}',
    '.nb-m-bal{display:flex;align-items:center;gap:6px;min-height:44px;box-sizing:border-box;padding:0 12px;border-radius:22px;',
    'background:var(--m-card);border:1px solid var(--m-accent2);color:var(--m-accent2);font-weight:800;',
    'font-variant-numeric:tabular-nums;box-shadow:0 0 10px rgba(255,207,74,.28)}',
    '.nb-m-body{flex:1;padding:12px;display:flex;flex-direction:column;gap:12px}',
    '.nb-m-gamebody{padding:8px}',
    '.nb-m-gameroot{flex:1;display:flex;flex-direction:column;min-height:0}',
    '.nb-m-nav{position:sticky;bottom:0;z-index:20;display:flex;background:rgba(11,7,20,.96);',
    'border-top:1px solid var(--m-line);padding-bottom:env(safe-area-inset-bottom)}',
    '.nb-m-tab{flex:1;min-height:56px;border:0;background:none;color:var(--m-dim);display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;gap:2px;font-size:11px;font-weight:700;font-family:inherit;cursor:pointer}',
    '.nb-m-tab span{font-size:22px;line-height:1}',
    '.nb-m-tab.on{color:var(--m-accent2);text-shadow:0 0 10px var(--m-accent2)}',
    '.nb-m-card{background:var(--m-card);border:1px solid var(--m-line);border-radius:16px;padding:14px}',
    '.nb-m-hi{font-size:18px;margin-bottom:8px}',
    '.nb-m-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.nb-m-dim{color:var(--m-dim)}.sm{font-size:13px}',
    '.nb-m-xp{height:8px;border-radius:4px;background:rgba(255,255,255,.08);margin:8px 0 6px;overflow:hidden}',
    '.nb-m-xp i{display:block;height:100%;background:linear-gradient(90deg,var(--m-accent),var(--m-accent2));border-radius:4px;box-shadow:var(--m-glow)}',
    '.nb-m-bonus{display:flex;align-items:center;justify-content:space-between;gap:10px;border-color:rgba(255,207,74,.4)}',
    '.nb-m-b1{font-weight:800;font-size:16px}',
    '.nb-m-chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}',
    '.nb-m-chips:empty{display:none}',
    '.nb-m-chip{flex:0 0 auto;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--m-line);',
    'background:var(--m-card);color:var(--m-dim);font-size:15px;font-weight:700;font-family:inherit;cursor:pointer}',
    '.nb-m-chip.on{color:#1d1300;background:var(--m-accent2);border-color:var(--m-accent2)}',
    '.nb-m-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}',
    '.nb-m-game{position:relative;min-height:140px;box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;',
    'gap:4px;padding:12px;border-radius:16px;border:1px solid var(--m-line);color:var(--m-text);text-align:left;font-family:inherit;',
    'background:linear-gradient(160deg,var(--m-card2),var(--m-card));cursor:pointer;box-shadow:inset 0 0 20px rgba(180,107,255,.08)}',
    '.nb-m-game:active{transform:scale(.97)}',
    '.nb-m-game .ic{font-size:38px;line-height:1.1;filter:drop-shadow(0 0 8px rgba(180,107,255,.6))}',
    '.nb-m-game .nm{font-size:16px;font-weight:800}',
    '.nb-m-game .ds{font-size:12px;color:var(--m-dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.nb-m-game .mt{margin-top:auto;font-size:12px;color:var(--m-accent2);font-weight:700}',
    '.nb-m-game .fv{position:absolute;top:8px;right:10px;font-size:18px}',
    '.nb-m-empty{grid-column:1/-1;text-align:center;color:var(--m-dim);padding:28px 8px}',
    '.nb-m-h2{margin:4px 0 0;font-size:20px;font-weight:800}',
    '.nb-m-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}',
    '.nb-m-tile{background:var(--m-card);border:1px solid var(--m-line);border-radius:14px;padding:12px}',
    '.nb-m-tile small{display:block;color:var(--m-dim);font-size:12px;margin-bottom:4px}',
    '.nb-m-tile b{font-size:18px;font-variant-numeric:tabular-nums}',
    '.good{color:var(--m-good)}.bad{color:var(--m-bad)}',
    '.nb-m-hist{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}',
    '.nb-m-hist:last-child{border-bottom:0}',
    '.nb-m-hist .ic{font-size:26px}.nb-m-hist .tx{flex:1;min-width:0}',
    '.nb-m-hist .tx b{display:block;font-size:15px}.nb-m-hist .tx small{color:var(--m-dim)}',
    '.nb-m-hist .am{font-weight:800;font-variant-numeric:tabular-nums}',
    '.nb-m-ach{display:flex;align-items:center;gap:12px;padding:12px}',
    '.nb-m-ach .ic{font-size:32px}.nb-m-ach.lock{opacity:.45;filter:grayscale(1)}',
    '.nb-m-ach b{display:block}.nb-m-ach small{color:var(--m-dim)}',
    '.nb-m-field{display:flex;gap:8px;align-items:center}',
    '.nb-m-input{flex:1;min-width:0;box-sizing:border-box;min-height:44px;border-radius:12px;border:1px solid var(--m-line);',
    'background:var(--m-bg);color:var(--m-text);font-size:16px;padding:0 12px}',
    'textarea.nb-m-input{width:100%;min-height:140px;padding:10px;font-size:13px;font-family:monospace}',
    '.nb-m-range{flex:1;min-height:44px;accent-color:var(--m-accent)}',
    '.nb-m-btns{display:flex;flex-wrap:wrap;gap:8px}',
    '.nb-m-btns .nb-m-btn{flex:1 1 140px}',
    '.nb-m-note{font-size:12px;color:var(--m-dim);line-height:1.4}',
    '.nb-m-acc summary{min-height:44px;display:flex;align-items:center;font-weight:800;font-size:16px;cursor:pointer}',
    '.nb-m-rules h4{margin:14px 0 6px;color:var(--m-accent2);font-size:15px}',
    '.nb-m-rules p{margin:0;line-height:1.45}',
    '.nb-m-rules ul,.nb-m-rules ol{margin:0;padding-left:20px;line-height:1.5}',
    '.nb-m-rules ul.pay{list-style:none;padding:0}',
    '.nb-m-rules ul.pay li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07)}',
    '.nb-m-rules ul.pay b{color:var(--m-accent2);white-space:nowrap}',
    '.nb-m-rules details{border-bottom:1px solid rgba(255,255,255,.07)}',
    '.nb-m-rules details summary{min-height:44px;display:flex;align-items:center;font-weight:700;cursor:pointer}',
    '.nb-m-ov{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;',
    'box-sizing:border-box;background:rgba(5,2,12,.78);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:nbmFade .2s}',
    '.nb-m-ov.out{opacity:0;transition:opacity .2s}',
    '.nb-m-dlg{width:100%;max-width:420px;max-height:88vh;max-height:88dvh;display:flex;flex-direction:column;box-sizing:border-box;',
    'background:linear-gradient(160deg,var(--m-card2),var(--m-card));border:1px solid var(--m-accent);border-radius:20px;',
    'padding:18px;box-shadow:0 0 30px rgba(180,107,255,.4);animation:nbmPop .25s}',
    '.nb-m-dlg-t{font-size:20px;font-weight:800;margin-bottom:10px}',
    '.nb-m-dlg-b{overflow-y:auto;-webkit-overflow-scrolling:touch;line-height:1.45;font-size:15px}',
    '.nb-m-dlg-b p{margin:0 0 10px}',
    '.nb-m-dlg-f{display:flex;gap:8px;margin-top:14px}.nb-m-dlg-f .nb-m-btn{flex:1}',
    '.nb-m-big{text-align:center;font-size:34px;font-weight:900;color:var(--m-accent2);text-shadow:0 0 14px var(--m-accent2);margin:8px 0}',
    '.nb-m-tour{text-align:center;min-height:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}',
    '.nb-m-tour .ic{font-size:64px;filter:drop-shadow(0 0 12px var(--m-accent))}',
    '.nb-m-tour h3{margin:0;font-size:20px}.nb-m-tour p{margin:0;color:var(--m-dim)}',
    '.nb-m-dots{display:flex;justify-content:center;gap:6px;margin-top:10px}',
    '.nb-m-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.2)}',
    '.nb-m-dots i.on{background:var(--m-accent2);box-shadow:0 0 8px var(--m-accent2)}',
    '.nb-m-splash{position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
    'background:radial-gradient(100% 70% at 50% 40%,#2a1250,#0b0714 70%);transition:opacity .45s}',
    '.nb-m-splash.out{opacity:0;pointer-events:none}',
    '.nb-m-spl-ico{font-size:72px;animation:nbmPulse 1.4s ease-in-out infinite}',
    '.nb-m-spl-logo{font-size:42px;font-weight:900;letter-spacing:1px;background:linear-gradient(90deg,#b46bff,#ffcf4a);',
    '-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 12px rgba(180,107,255,.7))}',
    '.nb-m-spl-sub{color:var(--m-dim);font-size:13px;text-align:center;padding:0 24px}',
    '.nb-m-spl-bar{width:60%;max-width:260px;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:18px}',
    '.nb-m-spl-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#b46bff,#ffcf4a);transition:width .3s}',
    '.nb-m-spl-msg{font-size:12px;color:var(--m-dim);min-height:16px}',
    '.nb-m-pause{position:fixed;inset:0;z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'background:rgba(5,2,12,.88);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);text-align:center;padding:24px;cursor:pointer}',
    '.nb-m-pause .ic{font-size:64px}.nb-m-pause b{font-size:24px}.nb-m-pause span{color:var(--m-dim)}',
    '.nb-m-fatal{padding:24px;text-align:center;color:var(--m-text)}',
    '.nb-m-fatal pre{text-align:left;white-space:pre-wrap;background:var(--m-card);padding:12px;border-radius:12px;font-size:12px;color:var(--m-bad)}',
    '@keyframes nbmFade{from{opacity:0}to{opacity:1}}',
    '@keyframes nbmPop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}',
    '@keyframes nbmPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}'
  ].join('');

  function injectStyles() {
    if (doc.getElementById('nb-main-style')) return;
    var st = doc.createElement('style');
    st.id = 'nb-main-style';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function ensureRoot() {
    var app = doc.getElementById('app');
    if (!app) {
      app = doc.createElement('div');
      app.id = 'app';
      doc.body.appendChild(app);
    }
    return app;
  }

  /* ------------------------------------------------------------------------
   * Тема
   * ---------------------------------------------------------------------- */
  function applyTheme(name, persist) {
    if (!THEMES[name]) name = 'violet';
    var root = doc.documentElement;
    root.setAttribute('data-theme', name);
    root.style.colorScheme = 'dark';
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      doc.head.appendChild(meta);
    }
    meta.setAttribute('content', THEMES[name].color);
    if (persist) sSet(K.THEME, name);
    emit('theme:change', { theme: name });
    return name;
  }

  function getTheme() {
    return doc.documentElement.getAttribute('data-theme') || 'violet';
  }

  /* ------------------------------------------------------------------------
   * Игрок
   * ---------------------------------------------------------------------- */
  function sanitizeName(s) {
    s = String(s == null ? '' : s).replace(/[<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!s) {
      var n = 100 + Math.floor(Math.random() * 900);
      try { n = NB.RNG.int(100, 999); } catch (e) { /* запасной вариант */ }
      s = 'Игрок' + n;
    }
    return s;
  }

  function getPlayerName() {
    var p = sGet(K.PLAYER, null);
    return (p && p.name) ? p.name : 'Игрок';
  }

  function setPlayerName(name) {
    var p = sGet(K.PLAYER, null) || { created: Date.now() };
    p.name = sanitizeName(name);
    sSet(K.PLAYER, p);
    emit('player:change', { name: p.name });
    return p.name;
  }

  /* ------------------------------------------------------------------------
   * Диалоги (собственная лёгкая реализация — не зависит от формы NB.UI.modal)
   * opts: {title, html, buttons:[{text, value, kind, keep, id, onClick(api, btn)}],
   *        dismissible, onRender(box, api)}
   * ---------------------------------------------------------------------- */
  function openDialog(o) {
    o = o || {};
    var ov = h('div', 'nb-m-ov');
    var box = h('div', 'nb-m-dlg');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = (o.title ? '<div class="nb-m-dlg-t">' + esc(o.title) + '</div>' : '') +
      '<div class="nb-m-dlg-b">' + (o.html || '') + '</div><div class="nb-m-dlg-f"></div>';
    ov.appendChild(box);

    var foot = box.querySelector('.nb-m-dlg-f');
    var api = { el: box, closed: false };
    var resolveFn;
    api.promise = new Promise(function (r) { resolveFn = r; });

    function onKey(e) {
      if (e.key === 'Escape' && o.dismissible) api.close(undefined);
    }

    api.close = function (v) {
      if (api.closed) return;
      api.closed = true;
      doc.removeEventListener('keydown', onKey);
      state.dialogs = Math.max(0, state.dialogs - 1);
      ov.classList.add('out');
      setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 220);
      resolveFn(v);
    };

    var btns = o.buttons || [{ text: 'OK', kind: 'primary', value: true }];
    btns.forEach(function (bd) {
      var b = h('button', 'nb-m-btn ' + (bd.kind || ''), esc(bd.text));
      b.type = 'button';
      if (bd.id) b.setAttribute('data-id', bd.id);
      b.addEventListener('click', function () {
        sfx('click');
        if (bd.onClick) {
          var r = bd.onClick(api, b);
          if (r === false) return;
        }
        if (!bd.keep) api.close(bd.value);
      });
      foot.appendChild(b);
    });

    if (o.dismissible) {
      ov.addEventListener('click', function (e) { if (e.target === ov) api.close(undefined); });
    }
    doc.addEventListener('keydown', onKey);
    doc.body.appendChild(ov);
    state.dialogs++;
    if (o.onRender) o.onRender(box, api);
    return api;
  }

  /* ------------------------------------------------------------------------
   * Правила игр
   * ---------------------------------------------------------------------- */
  function listHtml(tag, arr, cls) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>' +
      arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</' + tag + '>';
  }

  function payoutRow(p) {
    if (p == null) return '';
    if (typeof p !== 'object') return '<li>' + esc(p) + '</li>';
    var l = p.combo || p.name || p.label || p.title || p.hand || p.bet || '';
    var r = p.pays || p.payout || p.multiplier || p.win || p.value || p.x || '';
    if (!l && !r) {
      r = Object.keys(p).map(function (k) { return p[k]; }).join(' — ');
    }
    return '<li><span>' + esc(l) + '</span><b>' + esc(r) + '</b></li>';
  }

  function rulesHtml(r) {
    var s = '<div class="nb-m-rules">';
    if (r.goal) s += '<h4>🎯 Цель</h4><p>' + esc(r.goal) + '</p>';
    if (r.howToPlay && r.howToPlay.length) s += '<h4>📋 Как играть</h4>' + listHtml('ol', r.howToPlay);
    if (r.payouts && r.payouts.length) {
      s += '<h4>💰 Выплаты</h4><ul class="pay">' + r.payouts.map(payoutRow).join('') + '</ul>';
    }
    if (r.tips && r.tips.length) s += '<h4>💡 Советы</h4>' + listHtml('ul', r.tips);
    if (r.faq && r.faq.length) {
      s += '<h4>❓ Вопросы и ответы</h4>' + r.faq.map(function (f) {
        var q = f && (f.q || f.question) || '';
        var a = f && (f.a || f.answer) || '';
        return '<details><summary>' + esc(q) + '</summary><p>' + esc(a) + '</p></details>';
      }).join('');
    }
    return s + '</div>';
  }

  function showRules(gameId) {
    var r = safe(function () { return NB.Rules.get(gameId); }, null);
    if (!r) { toast('Правила для этой игры пока не добавлены', 'info'); return null; }
    var g = gameById(gameId);
    return openDialog({
      title: (g && g.icon ? g.icon + ' ' : '📖 ') + (r.title || (g && g.name) || 'Правила'),
      html: rulesHtml(r),
      buttons: [{ text: 'Понятно', kind: 'primary', value: true }],
      dismissible: true
    });
  }

  /* ------------------------------------------------------------------------
   * Контекст экрана: авто-очистка подписок, таймеров, слушателей
   * ---------------------------------------------------------------------- */
  function makeCtx() {
    var c = { alive: true, cl: [] };
    c.on = function (n, f) {
      NB.Events.on(n, f);
      c.cl.push(function () { NB.Events.off(n, f); });
    };
    c.listen = function (t, ev, f, o) {
      t.addEventListener(ev, f, o);
      c.cl.push(function () { t.removeEventListener(ev, f, o); });
    };
    c.timeout = function (f, ms) {
      var id = setTimeout(f, ms);
      c.cl.push(function () { clearTimeout(id); });
      return id;
    };
    c.interval = function (f, ms) {
      var id = setInterval(f, ms);
      c.cl.push(function () { clearInterval(id); });
      return id;
    };
    c.destroy = function () {
      c.alive = false;
      var list = c.cl;
      c.cl = [];
      list.forEach(function (f) { try { f(); } catch (e) { warn(e); } });
    };
    return c;
  }

  // Обёртка экрана для Router: build(container, params, ctx) может вернуть функцию очистки
  function defineScreen(id, build) {
    var ctx = null, root = null, cleanup = null;
    return {
      mount: function (container, params) {
        state.screen = id;
        root = container;
        ctx = makeCtx();
        try {
          cleanup = build(container, params || {}, ctx) || null;
        } catch (e) {
          console.error('[NB.Main] Ошибка экрана ' + id, e);
          container.innerHTML = '<div class="nb-m-fatal">Не удалось открыть экран 😕<pre>' + esc(e && e.message) + '</pre></div>';
        }
      },
      unmount: function () {
        if (cleanup) { try { cleanup(); } catch (e) { warn(e); } cleanup = null; }
        if (ctx) { ctx.destroy(); ctx = null; }
        if (root) { root.innerHTML = ''; root = null; }
      }
    };
  }

  /* ------------------------------------------------------------------------
   * Каркас страницы: верхняя панель с балансом + контент + нижняя навигация
   * opts: {title, back, rulesFor, tab}
   * ---------------------------------------------------------------------- */
  var TABS = [
    { id: 'lobby', ico: '🎰', t: 'Игры' },
    { id: 'stats', ico: '📊', t: 'Статистика' },
    { id: 'achievements', ico: '🏆', t: 'Награды' },
    { id: 'settings', ico: '⚙️', t: 'Ещё' }
  ];

  function buildShell(container, ctx, opts) {
    container.innerHTML = '';
    var page = h('div', 'nb-m-page');
    var top = h('div', 'nb-m-top');

    if (opts.back) {
      var back = h('button', 'nb-m-btn', '←');
      back.type = 'button';
      back.setAttribute('aria-label', 'Назад');
      ctx.listen(back, 'click', function () { sfx('click'); NB.Router.back(); });
      top.appendChild(back);
    }

    top.appendChild(h('div', 'nb-m-title' + (opts.back ? '' : ' logo'), esc(opts.title || 'NaebBet')));

    if (opts.rulesFor) {
      var rb = h('button', 'nb-m-btn', '📖');
      rb.type = 'button';
      rb.setAttribute('aria-label', 'Правила');
      ctx.listen(rb, 'click', function () { sfx('click'); showRules(opts.rulesFor); });
      top.appendChild(rb);
    }

    // Чип баланса с анимацией
    var chip = h('div', 'nb-m-bal', '<span>🪙</span><b></b>');
    var val = chip.querySelector('b');
    var shown = balance();
    val.textContent = fmt(shown);
    ctx.on('balance:change', function () {
      var to = balance();
      var from = shown;
      shown = to;
      if (from === to) return;
      try { NB.UI.animateNumber(val, from, to, 600); } catch (e) { val.textContent = fmt(to); }
      ctx.timeout(function () { if (shown === to) val.textContent = fmt(to); }, 680);
    });
    top.appendChild(chip);
    page.appendChild(top);

    var body = h('div', 'nb-m-body');
    page.appendChild(body);

    if (false) { // нижняя навигация теперь в index.html
      var nav = h('div', 'nb-m-nav');
      TABS.forEach(function (t) {
        var b = h('button', 'nb-m-tab' + (t.id === opts.tab ? ' on' : ''), '<span>' + t.ico + '</span>' + esc(t.t));
        b.type = 'button';
        ctx.listen(b, 'click', function () {
          if (t.id === opts.tab) return;
          sfx('click');
          NB.Router.go(t.id);
        });
        nav.appendChild(b);
      });
      page.appendChild(nav);
    }

    container.appendChild(page);
    return body;
  }

  /* ------------------------------------------------------------------------
   * Экран: лобби
   * ---------------------------------------------------------------------- */
  function levelHtml() {
    var i = safe(function () { return NB.Levels.getInfo(); }, null);
    if (!i) return '';
    var xp = +i.xp || 0, next = +i.xpToNext || 0;
    var total = xp + next;
    var pct = total > 0 ? Math.max(4, Math.min(100, Math.round(xp / total * 100))) : 100;
    return '<div class="nb-m-row"><b>⭐ Ур. ' + esc(i.level) + '</b><span class="nb-m-dim">' + esc(i.title || '') + '</span></div>' +
      '<div class="nb-m-xp"><i style="width:' + pct + '%"></i></div>' +
      '<div class="nb-m-dim sm">Опыт: ' + esc(xp) + ' · до следующего уровня: ' + esc(next) + '</div>';
  }

  function favoriteId() {
    var f = safe(function () { return NB.Stats.getFavoriteGame(); }, null);
    if (f && typeof f === 'object') return f.gameId || f.id || null;
    return f || null;
  }

  function buildLobby(container, params, ctx) {
    var body = buildShell(container, ctx, { tab: 'lobby' });

    var hero = h('div', 'nb-m-card');
    body.appendChild(hero);
    function renderHero() {
      hero.innerHTML = '<div class="nb-m-hi">Привет, <b>' + esc(getPlayerName()) + '</b>! 👋</div>' + levelHtml();
    }
    renderHero();

    var bonus = h('div', 'nb-m-card nb-m-bonus');
    body.appendChild(bonus);
    function renderBonus() {
      var st = dailyStatus();
      if (st.available) {
        bonus.innerHTML = '<div><div class="nb-m-b1">🎁 Ежедневный бонус</div><div class="nb-m-dim sm">День ' +
          st.streak + ' · +' + esc(fmt(st.amount)) + ' NB</div></div><button type="button" class="nb-m-btn gold">Забрать</button>';
        bonus.querySelector('button').onclick = function () {
          if (claimDaily()) renderBonus();
        };
      } else {
        var left = Math.max(0, st.nextAt - Date.now());
        var hrs = Math.floor(left / 3600000);
        var min = Math.ceil((left % 3600000) / 60000);
        if (min === 60) { hrs += 1; min = 0; }
        bonus.innerHTML = '<div><div class="nb-m-b1">⏳ Следующий бонус</div><div class="nb-m-dim sm">через ' +
          hrs + ' ч ' + min + ' мин</div></div><span style="font-size:28px">🎁</span>';
      }
    }
    renderBonus();

    var chips = h('div', 'nb-m-chips');
    var grid = h('div', 'nb-m-grid');
    body.appendChild(chips);
    body.appendChild(grid);

    var games = safeGames();
    var cats = [];
    games.forEach(function (g) {
      if (g.category && cats.indexOf(g.category) < 0) cats.push(g.category);
    });
    if (state.filter !== 'all' && cats.indexOf(state.filter) < 0) state.filter = 'all';

    function renderGames() {
      chips.innerHTML = '';
      if (cats.length > 1) {
        ['all'].concat(cats).forEach(function (c) {
          var b = h('button', 'nb-m-chip' + (state.filter === c ? ' on' : ''), esc(c === 'all' ? 'Все' : c));
          b.type = 'button';
          b.onclick = function () { sfx('click'); state.filter = c; renderGames(); };
          chips.appendChild(b);
        });
      }
      grid.innerHTML = '';
      var list = games.filter(function (g) { return state.filter === 'all' || g.category === state.filter; });
      if (!list.length) {
        grid.appendChild(h('div', 'nb-m-empty', 'Игры пока не добавлены'));
        return;
      }
      var fav = favoriteId();
      list.forEach(function (g) {
        var b = h('button', 'nb-m-game',
          (fav && fav === g.id ? '<span class="fv" title="Любимая">⭐</span>' : '') +
          '<div class="ic">' + esc(g.icon || '🎲') + '</div>' +
          '<div class="nm">' + esc(g.name) + '</div>' +
          '<div class="ds">' + esc(g.description || '') + '</div>' +
          '<div class="mt">' + esc(fmt(g.minBet)) + ' – ' + esc(fmt(g.maxBet)) +
          (fmtRtp(g.rtp) ? ' · ' + esc(fmtRtp(g.rtp)) : '') + '</div>');
        b.type = 'button';
        b.onclick = function () { sfx('click'); NB.Router.go('game', { gameId: g.id }); };
        grid.appendChild(b);
      });
    }
    renderGames();

    ctx.on('round:settled', function () { ctx.timeout(renderHero, 80); });
    ctx.on('bonus:claimed', renderBonus);
    ctx.on('player:change', renderHero);
    ctx.interval(renderBonus, 20000);
    ctx.timeout(function () { checkRescue(); }, 700);
  }

  /* ------------------------------------------------------------------------
   * Экран: игра (обёртка вокруг NB.Games)
   * ---------------------------------------------------------------------- */
  function buildGame(container, params, ctx) {
    var game = gameById(params.gameId);
    if (!game) {
      var b0 = buildShell(container, ctx, { back: true, title: 'Игра' });
      b0.appendChild(h('div', 'nb-m-empty', 'Игра не найдена 😕'));
      return null;
    }
    var body = buildShell(container, ctx, {
      back: true,
      title: (game.icon || '🎲') + ' ' + game.name,
      rulesFor: game.id
    });
    body.classList.add('nb-m-gamebody');
    var root = h('div', 'nb-m-gameroot');
    root.id = 'nb-game-root';
    body.appendChild(root);

    state.activeGame = game;
    try {
      game.mount(root);
    } catch (e) {
      console.error('[NB.Main] Ошибка запуска игры ' + game.id, e);
      root.innerHTML = '<div class="nb-m-empty">Не удалось запустить игру 😕</div>';
      toast('Ошибка запуска игры', 'error');
      sfx('error');
    }

    return function () {
      try { game.unmount(); } catch (e) { console.error('[NB.Main] Ошибка unmount игры', e); }
      state.activeGame = null;
    };
  }

  /* ------------------------------------------------------------------------
   * Экран: статистика
   * ---------------------------------------------------------------------- */
  function tile(label, value, cls) {
    return '<div class="nb-m-tile"><small>' + esc(label) + '</small><b class="' + (cls || '') + '">' + esc(value) + '</b></div>';
  }

  function buildStats(container, params, ctx) {
    var body = buildShell(container, ctx, { tab: 'stats', title: 'Статистика' });
    var g = safe(function () { return NB.Stats.getGlobal(); }, null) || {};

    var rounds = firstNum(g, ['rounds', 'totalRounds', 'roundsPlayed', 'count']);
    var wins = firstNum(g, ['wins', 'totalWins']);
    var losses = firstNum(g, ['losses', 'totalLosses']);
    var wagered = firstNum(g, ['totalBet', 'wagered', 'totalWagered', 'bets']);
    var paid = firstNum(g, ['totalPayout', 'payout', 'paid', 'payouts']);
    var profit = firstNum(g, ['profit', 'net', 'totalProfit']);
    if (profit === null && wagered !== null && paid !== null) profit = paid - wagered;
    var biggest = firstNum(g, ['biggestWin', 'maxWin', 'bestWin', 'maxPayout']);

    var t = '';
    if (rounds !== null) t += tile('Раундов', rounds);
    if (wins !== null) t += tile('Побед', wins, 'good');
    if (losses !== null) t += tile('Поражений', losses, 'bad');
    if (rounds && wins !== null) t += tile('Процент побед', Math.round(wins / rounds * 100) + '%');
    if (wagered !== null) t += tile('Поставлено', fmt(wagered));
    if (paid !== null) t += tile('Выплачено', fmt(paid));
    if (profit !== null) t += tile('Итог', (profit > 0 ? '+' : '') + fmt(profit), profit >= 0 ? 'good' : 'bad');
    if (biggest !== null) t += tile('Макс. выигрыш', fmt(biggest), 'good');

    var favId = favoriteId();
    if (favId) {
      var fg = gameById(favId);
      t += tile('Любимая игра', fg ? (fg.icon || '') + ' ' + fg.name : favId);
    }

    var s = safe(function () { return NB.Stats.getStreaks(); }, null);
    if (s !== null && s !== undefined) {
      var cw = firstNum(s, ['currentWin', 'currentWinStreak', 'winStreak', 'win', 'current']);
      var bw = firstNum(s, ['bestWin', 'maxWinStreak', 'bestWinStreak', 'maxWin', 'best', 'max']);
      var cl = firstNum(s, ['currentLose', 'currentLoss', 'loseStreak', 'lossStreak', 'lose', 'loss']);
      if (cw !== null) t += tile('Серия побед', cw);
      if (bw !== null) t += tile('Рекорд серии', bw);
      if (cl !== null) t += tile('Серия поражений', cl);
    }

    if (t) {
      body.appendChild(h('div', 'nb-m-h2', '📊 Общая'));
      body.appendChild(h('div', 'nb-m-tiles', t));
    } else {
      body.appendChild(h('div', 'nb-m-card nb-m-dim', 'Пока нет данных. Сыграй первый раунд!'));
    }

    // По играм
    var per = '';
    safeGames().forEach(function (gm) {
      var gs = safe(function () { return NB.Stats.getGame(gm.id); }, null);
      var r = firstNum(gs, ['rounds', 'totalRounds', 'roundsPlayed', 'count']);
      if (!r) return;
      var gb = firstNum(gs, ['totalBet', 'wagered', 'bets']);
      var gp = firstNum(gs, ['totalPayout', 'payout', 'paid']);
      var pr = firstNum(gs, ['profit', 'net', 'totalProfit']);
      if (pr === null && gb !== null && gp !== null) pr = gp - gb;
      per += '<div class="nb-m-hist"><div class="ic">' + esc(gm.icon || '🎲') + '</div><div class="tx"><b>' + esc(gm.name) +
        '</b><small>Раундов: ' + r + '</small></div>' +
        (pr !== null ? '<div class="am ' + (pr >= 0 ? 'good' : 'bad') + '">' + (pr > 0 ? '+' : '') + esc(fmt(pr)) + '</div>' : '') + '</div>';
    });
    if (per) {
      body.appendChild(h('div', 'nb-m-h2', '🎲 По играм'));
      body.appendChild(h('div', 'nb-m-card', per));
    }

    // История
    body.appendChild(h('div', 'nb-m-h2', '🕘 История'));
    var chips = h('div', 'nb-m-chips');
    var histBox = h('div', 'nb-m-card');
    body.appendChild(chips);
    body.appendChild(histBox);

    var hist = safe(function () { return NB.Stats.getHistory({ limit: 100 }); }, []);
    if (!Array.isArray(hist)) hist = [];

    function renderHist() {
      chips.innerHTML = '';
      [['all', 'Все'], ['win', 'Победы'], ['lose', 'Проигрыши']].forEach(function (c) {
        var b = h('button', 'nb-m-chip' + (state.histFilter === c[0] ? ' on' : ''), c[1]);
        b.type = 'button';
        b.onclick = function () { sfx('click'); state.histFilter = c[0]; renderHist(); };
        chips.appendChild(b);
      });
      var list = hist.filter(function (r) {
        var net = (+r.payout || 0) - (+r.bet || 0);
        if (state.histFilter === 'win') return net > 0;
        if (state.histFilter === 'lose') return net < 0;
        return true;
      }).slice(0, 30);
      if (!list.length) { histBox.innerHTML = '<div class="nb-m-dim">Здесь пока пусто</div>'; return; }
      histBox.innerHTML = list.map(function (r) {
        var gm = gameById(r.gameId);
        var net = (+r.payout || 0) - (+r.bet || 0);
        return '<div class="nb-m-hist"><div class="ic">' + esc(gm ? gm.icon || '🎲' : '🎲') + '</div><div class="tx"><b>' +
          esc(gm ? gm.name : r.gameId) + '</b><small>' + esc(fmtTime(r.ts)) + ' · ставка ' + esc(fmt(r.bet)) + '</small></div>' +
          '<div class="am ' + (net >= 0 ? 'good' : 'bad') + '">' + (net > 0 ? '+' : '') + esc(fmt(net)) + '</div></div>';
      }).join('');
    }
    renderHist();

    var reset = h('button', 'nb-m-btn danger', '🗑 Сбросить статистику');
    reset.type = 'button';
    ctx.listen(reset, 'click', function () {
      sfx('click');
      NB.UI.confirm('Удалить всю статистику? Баланс и уровень не изменятся.').then(function (ok) {
        if (!ok) return;
        safe(function () { NB.Stats.reset(); });
        toast('Статистика сброшена', 'success');
        NB.Router.go('stats');
      });
    });
    body.appendChild(reset);
  }

  /* ------------------------------------------------------------------------
   * Экран: достижения
   * ---------------------------------------------------------------------- */
  function buildAchievements(container, params, ctx) {
    var body = buildShell(container, ctx, { tab: 'achievements', title: 'Награды' });
    var all = safe(function () { return NB.Achievements.getAll(); }, []);
    if (!Array.isArray(all)) all = [];
    var un = safe(function () { return NB.Achievements.getUnlocked(); }, []);
    if (!Array.isArray(un)) un = [];
    var set = {};
    un.forEach(function (x) { set[(x && typeof x === 'object') ? x.id : x] = true; });

    var opened = all.filter(function (a) { return a.unlocked || set[a.id]; }).length;
    body.appendChild(h('div', 'nb-m-h2', '🏆 Открыто ' + opened + ' из ' + all.length));

    if (!all.length) {
      body.appendChild(h('div', 'nb-m-card nb-m-dim', 'Достижения пока недоступны'));
      return;
    }
    all.forEach(function (a) {
      var ok = a.unlocked || set[a.id];
      body.appendChild(h('div', 'nb-m-card nb-m-ach' + (ok ? '' : ' lock'),
        '<div class="ic">' + esc(a.icon || (ok ? '🏆' : '🔒')) + '</div><div><b>' + esc(a.title || a.name || a.id) +
        '</b><small>' + esc(a.description || a.desc || '') + '</small></div>'));
    });
  }

  /* ------------------------------------------------------------------------
   * Экран: правила всех игр
   * ---------------------------------------------------------------------- */
  function buildRulesScreen(container, params, ctx) {
    var body = buildShell(container, ctx, { back: true, title: 'Правила игр' });
    var any = false;
    safeGames().forEach(function (g) {
      var r = safe(function () { return NB.Rules.get(g.id); }, null);
      if (!r) return;
      any = true;
      var d = h('details', 'nb-m-card nb-m-acc',
        '<summary>' + esc(g.icon || '🎲') + '&nbsp;' + esc(r.title || g.name) + '</summary>' + rulesHtml(r));
      if (params.gameId === g.id) d.open = true;
      body.appendChild(d);
    });
    if (!any) body.appendChild(h('div', 'nb-m-card nb-m-dim', 'Правила пока не добавлены'));
  }

  /* ------------------------------------------------------------------------
   * Экран: настройки
   * ---------------------------------------------------------------------- */
  function downloadText(name, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function openExport() {
    var text;
    try {
      var data = NB.Storage.exportAll();
      text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    } catch (e) {
      toast('Не удалось подготовить экспорт', 'error');
      return;
    }
    openDialog({
      title: '📤 Экспорт сохранения',
      html: '<p class="nb-m-note">Сохрани файл или скопируй текст — позже его можно импортировать обратно.</p>' +
        '<textarea class="nb-m-input" readonly></textarea>',
      dismissible: true,
      onRender: function (box) { box.querySelector('textarea').value = text; },
      buttons: [
        { text: '💾 Файл', kind: 'primary', keep: true, onClick: function () {
          try { downloadText('naebbet-save-' + new Date().toISOString().slice(0, 10) + '.json', text); toast('Файл сохранён', 'success'); }
          catch (e) { toast('Скачивание недоступно — скопируй текст', 'error'); }
          return false;
        } },
        { text: '📋 Копия', keep: true, onClick: function (api) {
          var ta = api.el.querySelector('textarea');
          var done = function () { toast('Скопировано', 'success'); };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done, function () { ta.select(); doc.execCommand('copy'); done(); });
            } else { ta.select(); doc.execCommand('copy'); done(); }
          } catch (e) { toast('Не удалось скопировать', 'error'); }
          return false;
        } },
        { text: 'Закрыть', kind: 'ghost', value: true }
      ]
    });
  }

  function openImport() {
    openDialog({
      title: '📥 Импорт сохранения',
      html: '<p class="nb-m-note">Вставь текст сохранения или выбери файл. Текущий прогресс будет заменён.</p>' +
        '<textarea class="nb-m-input" placeholder="{ ... }"></textarea>' +
        '<input type="file" accept=".json,application/json,text/plain" class="nb-m-input" style="margin-top:8px;padding-top:9px">',
      dismissible: true,
      onRender: function (box) {
        var file = box.querySelector('input[type=file]');
        var ta = box.querySelector('textarea');
        file.addEventListener('change', function () {
          var f = file.files && file.files[0];
          if (!f) return;
          var rd = new FileReader();
          rd.onload = function () { ta.value = String(rd.result || ''); };
          rd.readAsText(f);
        });
      },
      buttons: [
        { text: 'Импортировать', kind: 'primary', keep: true, onClick: function (api) {
          var txt = api.el.querySelector('textarea').value.trim();
          if (!txt) { toast('Вставь данные или выбери файл', 'error'); sfx('error'); return false; }
          NB.UI.confirm('Заменить текущий прогресс импортируемым?').then(function (ok) {
            if (!ok) return;
            try {
              NB.Storage.importAll(txt);
              api.close(true);
              toast('Импорт выполнен, перезапуск…', 'success');
              setTimeout(function () { location.reload(); }, 900);
            } catch (e) {
              toast('Ошибка импорта: ' + (e && e.message ? e.message : 'неверный формат'), 'error');
              sfx('error');
            }
          });
          return false;
        } },
        { text: 'Отмена', kind: 'ghost', value: false }
      ]
    });
  }

  function buildSettings(container, params, ctx) {
    var body = buildShell(container, ctx, { tab: 'settings', title: 'Ещё' });

    // Игрок
    var cp = h('div', 'nb-m-card',
      '<div class="nb-m-h2" style="margin:0 0 10px">👤 Игрок</div>' +
      '<div class="nb-m-field"><input class="nb-m-input" maxlength="16" autocomplete="off"><button type="button" class="nb-m-btn primary">Сохранить</button></div>');
    var nameInp = cp.querySelector('input');
    nameInp.value = getPlayerName();
    ctx.listen(cp.querySelector('button'), 'click', function () {
      nameInp.value = setPlayerName(nameInp.value);
      sfx('coin');
      toast('Имя сохранено', 'success');
    });
    body.appendChild(cp);

    // Звук
    var vol = +sGet(K.VOLUME, 0.8);
    if (!isFinite(vol)) vol = 0.8;
    var muted = safe(function () { return NB.Audio.isMuted(); }, false);
    var cs = h('div', 'nb-m-card',
      '<div class="nb-m-h2" style="margin:0 0 10px">🔊 Звук</div>' +
      '<div class="nb-m-field"><button type="button" class="nb-m-btn" data-a="mute"></button>' +
      '<input type="range" class="nb-m-range" min="0" max="1" step="0.05"></div>');
    var muteBtn = cs.querySelector('[data-a=mute]');
    var rng = cs.querySelector('input');
    rng.value = vol;
    function paintMute() { muteBtn.textContent = muted ? '🔇 Выкл' : '🔊 Вкл'; }
    paintMute();
    ctx.listen(muteBtn, 'click', function () {
      muted = !muted;
      safe(function () { NB.Audio.setMuted(muted); });
      paintMute();
      if (!muted) sfx('click');
    });
    ctx.listen(rng, 'input', function () {
      vol = +rng.value;
      safe(function () { NB.Audio.setVolume(vol); });
    });
    ctx.listen(rng, 'change', function () { sSet(K.VOLUME, vol); sfx('coin'); });
    body.appendChild(cs);

    // Тема
    var ct = h('div', 'nb-m-card', '<div class="nb-m-h2" style="margin:0 0 10px">🎨 Тема</div><div class="nb-m-btns"></div>');
    var tb = ct.querySelector('.nb-m-btns');
    function paintThemes() {
      tb.innerHTML = '';
      Object.keys(THEMES).forEach(function (id) {
        var b = h('button', 'nb-m-btn' + (getTheme() === id ? ' primary' : ''), esc(THEMES[id].name));
        b.type = 'button';
        b.onclick = function () { sfx('click'); applyTheme(id, true); paintThemes(); };
        tb.appendChild(b);
      });
    }
    paintThemes();
    body.appendChild(ct);

    // Данные и справка
    var cd = h('div', 'nb-m-card',
      '<div class="nb-m-h2" style="margin:0 0 10px">🗂 Данные и справка</div><div class="nb-m-btns">' +
      '<button type="button" class="nb-m-btn" data-a="rules">📖 Правила игр</button>' +
      '<button type="button" class="nb-m-btn" data-a="tour">🧭 Тур по приложению</button>' +
      '<button type="button" class="nb-m-btn" data-a="exp">📤 Экспорт</button>' +
      '<button type="button" class="nb-m-btn" data-a="imp">📥 Импорт</button>' +
      '<button type="button" class="nb-m-btn danger" data-a="reset">🗑 Сбросить всё</button></div>');
    ctx.listen(cd, 'click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-a]') : null;
      if (!b) return;
      sfx('click');
      var a = b.getAttribute('data-a');
      if (a === 'rules') NB.Router.go('rules');
      else if (a === 'tour') runTour();
      else if (a === 'exp') openExport();
      else if (a === 'imp') openImport();
      else if (a === 'reset') {
        NB.UI.confirm('Удалить весь прогресс, статистику и вернуть стартовые монеты? Это нельзя отменить.').then(function (ok) {
          if (!ok) return;
          try { NB.Storage.resetAll(); } catch (er) { toast('Не удалось сбросить данные', 'error'); return; }
          toast('Данные сброшены, перезапуск…', 'success');
          setTimeout(function () { location.reload(); }, 900);
        });
      }
    });
    body.appendChild(cd);

    body.appendChild(h('div', 'nb-m-note',
      'NaebBet v' + esc(VERSION) + '. Игра использует виртуальные NB-монеты и не связана с реальными деньгами. ' +
      'Азартные игры могут вызывать зависимость — играй ради развлечения.'));
  }

  /* ------------------------------------------------------------------------
   * Первый запуск: имя + быстрый тур
   * ---------------------------------------------------------------------- */
  function runTour() {
    return new Promise(function (resolve) {
      var i = 0;
      var api = openDialog({
        html: '<div class="nb-m-tour"></div><div class="nb-m-dots"></div>',
        dismissible: false,
        buttons: [
          { text: 'Пропустить', kind: 'ghost', value: 'skip' },
          { text: 'Далее', kind: 'primary', id: 'next', keep: true, onClick: function (a) {
            i++;
            if (i >= TOUR.length) { a.close('done'); return false; }
            render(a);
            return false;
          } }
        ],
        onRender: function (box, a) { render(a); }
      });

      function render(a) {
        var s = TOUR[i];
        var box = a.el;
        box.querySelector('.nb-m-tour').innerHTML =
          '<div class="ic">' + s.ico + '</div><h3>' + esc(s.t) + '</h3><p>' + esc(s.d) + '</p>';
        box.querySelector('.nb-m-dots').innerHTML = TOUR.map(function (x, k) {
          return '<i class="' + (k === i ? 'on' : '') + '"></i>';
        }).join('');
        box.querySelector('[data-id=next]').textContent = (i === TOUR.length - 1) ? 'Поехали! 🚀' : 'Далее';
      }

      api.promise.then(resolve);
    });
  }

  async function runFirstRun() {
    var api = openDialog({
      title: '👋 Добро пожаловать!',
      html: '<p>Как тебя зовут?</p><input class="nb-m-input" style="width:100%" maxlength="16" placeholder="Твоё имя" autocomplete="off">' +
        '<p class="nb-m-note" style="margin-top:12px">NaebBet — игра на виртуальные NB-монеты. Реальных денег здесь нет, ' +
        'вывести и купить ничего нельзя.</p>',
      dismissible: false,
      buttons: [{ text: 'Дальше', kind: 'primary', value: 'ok' }],
      onRender: function (box, a) {
        var inp = box.querySelector('input');
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); inp.blur(); a.close('ok'); }
        });
      }
    });
    await api.promise;
    var name = sanitizeName(api.el.querySelector('input').value);
    sSet(K.PLAYER, { name: name, created: Date.now() });
    sSet(K.FIRST_RUN, true);
    // Первый ежедневный бонус — завтра (сегодня и так стартовый капитал)
    sSet(K.BONUS, { lastDaily: Date.now(), streak: 1, lastRescue: 0 });
    emit('player:change', { name: name });

    await runTour();
    toast('Добро пожаловать, ' + name + '! На счету ' + fmt(balance()) + ' NB-монет', 'success');
    sfx('win');
  }

  /* ------------------------------------------------------------------------
   * Бонусы
   * ---------------------------------------------------------------------- */
  function bonusState() {
    var b = sGet(K.BONUS, null) || {};
    return { lastDaily: +b.lastDaily || 0, streak: +b.streak || 0, lastRescue: +b.lastRescue || 0 };
  }

  function dailyStatus() {
    var b = bonusState();
    var now = Date.now();
    var since = now - b.lastDaily;
    var corrupted = b.lastDaily > now + 2 * DAY; // часы сильно «убежали» — не блокируем игрока навсегда
    var fresh = !b.lastDaily || corrupted;
    var available = fresh || since >= DAY;
    var streak = (fresh || since >= 2 * DAY) ? 1 : b.streak + 1;
    var amount = CONFIG.dailyBase + CONFIG.dailyStep * Math.min(streak - 1, CONFIG.dailyMaxSteps);
    return { available: available, amount: amount, streak: streak, nextAt: b.lastDaily + DAY };
  }

  function claimDaily() {
    var st = dailyStatus();
    if (!st.available) return false;
    try {
      NB.Wallet.add(st.amount, 'daily_bonus');
    } catch (e) {
      warn(e);
      toast('Не удалось начислить бонус', 'error');
      return false;
    }
    var b = bonusState();
    b.lastDaily = Date.now();
    b.streak = st.streak;
    sSet(K.BONUS, b);
    sfx('coin');
    toast('🎁 +' + fmt(st.amount) + ' NB-монет', 'success');
    emit('bonus:claimed', { type: 'daily', amount: st.amount, streak: st.streak });
    return st;
  }

  async function checkDaily() {
    var st = dailyStatus();
    if (!st.available) return;
    var api = openDialog({
      title: '🎁 Ежедневный бонус',
      html: '<p style="text-align:center">День <b>' + st.streak + '</b> подряд!</p>' +
        '<div class="nb-m-big">+' + esc(fmt(st.amount)) + '</div>' +
        '<p class="nb-m-note" style="text-align:center">Заходи каждый день — бонус растёт до +' +
        esc(fmt(CONFIG.dailyBase + CONFIG.dailyStep * CONFIG.dailyMaxSteps)) + '. Пропустишь день больше одних суток — серия начнётся заново.</p>',
      dismissible: false,
      buttons: [
        { text: 'Позже', kind: 'ghost', value: 'later' },
        { text: 'Забрать 🎁', kind: 'gold', value: 'claim' }
      ]
    });
    var r = await api.promise;
    if (r === 'claim') claimDaily();
  }

  function rescueNeeded() {
    var games = safeGames();
    var minBet = games.length ? Math.min.apply(null, games.map(function (g) { return +g.minBet || 1; })) : 10;
    return balance() < minBet;
  }

  async function checkRescue() {
    if (state.bonusBusy || state.dialogs > 0 || state.paused) return;
    if (!rescueNeeded()) return;
    var b = bonusState();
    if (Date.now() - b.lastRescue < CONFIG.rescueCooldownMs && b.lastRescue <= Date.now()) return;
    state.bonusBusy = true;
    try {
      var api = openDialog({
        title: '😅 Монеты закончились',
        html: '<p>На счету не хватает даже на минимальную ставку. Держи помощь от казино — это виртуальные монеты, возвращать не нужно.</p>' +
          '<div class="nb-m-big">+' + esc(fmt(CONFIG.rescueAmount)) + '</div>',
        dismissible: false,
        buttons: [
          { text: 'Не нужно', kind: 'ghost', value: 'no' },
          { text: 'Взять', kind: 'gold', value: 'yes' }
        ]
      });
      var r = await api.promise;
      if (r === 'yes') {
        try {
          NB.Wallet.add(CONFIG.rescueAmount, 'rescue_bonus');
          var s = bonusState();
          s.lastRescue = Date.now();
          sSet(K.BONUS, s);
          sfx('coin');
          toast('+' + fmt(CONFIG.rescueAmount) + ' NB-монет', 'success');
          emit('bonus:claimed', { type: 'rescue', amount: CONFIG.rescueAmount });
        } catch (e) { warn(e); toast('Не удалось начислить бонус', 'error'); }
      }
    } finally {
      state.bonusBusy = false;
    }
  }

  async function checkBonuses() {
    if (state.bonusBusy) return;
    state.bonusBusy = true;
    try { await checkDaily(); } catch (e) { warn(e); } finally { state.bonusBusy = false; }
    await checkRescue();
  }

  /* ------------------------------------------------------------------------
   * Склейка модулей на событии "round:settled"
   * ---------------------------------------------------------------------- */
  function announceAchievement(a) {
    if (!a) return;
    var key = typeof a === 'object' ? (a.id || a.title || a.name || JSON.stringify(a)) : String(a);
    if (state.announced[key]) return;
    state.announced[key] = true;
    setTimeout(function () { delete state.announced[key]; }, 4000);
    var title = typeof a === 'object' ? (a.title || a.name || a.id) : a;
    toast('🏆 Достижение: ' + title, 'success');
    sfx('win');
  }

  function currentLevel() {
    var i = safe(function () { return NB.Levels.getInfo(); }, null);
    return i ? +i.level || 0 : 0;
  }

  function onRoundSettled(d) {
    if (!d || typeof d !== 'object') return;

    // Защита от повторной обработки одного и того же раунда
    if (d.roundId != null) {
      if (state.seenRounds[d.roundId]) return;
      state.seenRounds[d.roundId] = 1;
      state.seenOrder.push(d.roundId);
      if (state.seenOrder.length > 200) delete state.seenRounds[state.seenOrder.shift()];
    }

    var bet = +d.bet;
    var payout = +d.payout;

    if (CONFIG.glueStats && NB.Stats && d.gameId && isFinite(bet) && isFinite(payout)) {
      safe(function () {
        NB.Stats.recordRound({ gameId: d.gameId, bet: bet, payout: payout, details: d.details, ts: d.ts || Date.now() });
      });
    }

    if (NB.Levels && isFinite(bet) && bet > 0) {
      safe(function () {
        var before = currentLevel();
        var xp = 5 + Math.min(45, Math.floor(bet / 50)) + (payout > bet ? 10 : 0);
        NB.Levels.addXp(xp);
        var after = currentLevel();
        if (after > before) {
          var info = NB.Levels.getInfo();
          toast('⭐ Новый уровень: ' + after + (info && info.title ? ' · ' + info.title : ''), 'success');
          sfx('bigwin');
        }
      });
    }

    if (NB.Achievements) {
      safe(function () {
        var res = NB.Achievements.check();
        if (Array.isArray(res)) res.forEach(announceAchievement);
      });
    }

    // Если монеты кончились — предложить помощь (после того, как игрок увидит результат)
    setTimeout(function () { checkRescue(); }, 2200);
  }

  /* ------------------------------------------------------------------------
   * Заставка
   * ---------------------------------------------------------------------- */
  function showSplash() {
    var s = h('div', 'nb-m-splash',
      '<div class="nb-m-spl-ico">🎰</div><div class="nb-m-spl-logo">NaebBet</div>' +
      '<div class="nb-m-spl-sub">виртуальное казино · NB-монеты · без реальных денег</div>' +
      '<div class="nb-m-spl-bar"><i></i></div><div class="nb-m-spl-msg">Запуск…</div>');
    s.id = 'nb-splash';
    doc.body.appendChild(s);
    state.splash = s;
  }

  function splashProgress(p, msg) {
    var s = state.splash;
    if (!s) return;
    var bar = s.querySelector('.nb-m-spl-bar i');
    var m = s.querySelector('.nb-m-spl-msg');
    if (bar) bar.style.width = Math.round(p * 100) + '%';
    if (m && msg) m.textContent = msg;
  }

  function hideSplash() {
    var s = state.splash;
    state.splash = null;
    if (!s) return Promise.resolve();
    s.classList.add('out');
    return sleep(480).then(function () { if (s.parentNode) s.parentNode.removeChild(s); });
  }

  function fatal(msg) {
    if (state.splash && state.splash.parentNode) state.splash.parentNode.removeChild(state.splash);
    state.splash = null;
    doc.body.innerHTML = '<div class="nb-m-fatal"><div style="font-size:56px">😵</div><h2>NaebBet не запустился</h2>' +
      '<pre>' + esc(msg) + '</pre><button type="button" class="nb-m-btn primary" onclick="location.reload()">Перезагрузить</button></div>';
  }

  /* ------------------------------------------------------------------------
   * Инициализация модулей
   * ---------------------------------------------------------------------- */
  async function initModules() {
    var missing = [];
    MODULES.forEach(function (m) {
      if (!NB[m.n]) {
        if (m.req) missing.push(m.n); else warn('Необязательный модуль отсутствует: NB.' + m.n);
      }
    });
    if (missing.length) {
      throw new Error('Не найдены обязательные модули: ' + missing.map(function (n) { return 'NB.' + n; }).join(', ') +
        '\nПроверь порядок подключения скриптов в index.html (main.js — последним).');
    }

    var app = ensureRoot();
    for (var i = 0; i < MODULES.length; i++) {
      var m = MODULES[i];
      var mod = NB[m.n];
      splashProgress(0.1 + 0.6 * (i / MODULES.length), 'Модуль ' + m.n + '…');
      if (mod && typeof mod.init === 'function') {
        try {
          if (m.n === 'Router') mod.init(app); else mod.init();
        } catch (e) {
          if (m.req) throw new Error('Ошибка инициализации NB.' + m.n + ': ' + (e && e.message ? e.message : e));
          warn('Ошибка инициализации NB.' + m.n, e);
        }
      }
      if (i % 3 === 2) await sleep(20);
    }
  }

  function restoreAudio() {
    if (!NB.Audio) return;
    var v = +sGet(K.VOLUME, NaN);
    if (isFinite(v)) safe(function () { NB.Audio.setVolume(Math.max(0, Math.min(1, v))); });
  }

  // Если вкладку убили в момент паузы — вернуть звук, который заглушили мы, а не игрок
  function recoverAutoMute() {
    var f = sGet(K.AUTOPAUSE, null);
    if (!f) return;
    if (!f.wasMuted && NB.Audio) safe(function () { NB.Audio.setMuted(false); });
    sRemove(K.AUTOPAUSE);
  }

  /* ------------------------------------------------------------------------
   * Регистрация экранов
   * ---------------------------------------------------------------------- */
  function registerScreens() {
    NB.Router.register('lobby', defineScreen('lobby', buildLobby));
    NB.Router.register('game', defineScreen('game', buildGame));
    NB.Router.register('stats', defineScreen('stats', buildStats));
    NB.Router.register('achievements', defineScreen('achievements', buildAchievements));
    NB.Router.register('rules', defineScreen('rules', buildRulesScreen));
    NB.Router.register('settings', defineScreen('settings', buildSettings));
  }

  /* ------------------------------------------------------------------------
   * Визуальная пауза при скрытии вкладки
   * ---------------------------------------------------------------------- */
  function showPauseOverlay() {
    if (state.pauseEl) return;
    var p = h('div', 'nb-m-pause', '<div class="ic">⏸</div><b>Пауза</b><span>Нажми, чтобы продолжить</span>');
    p.addEventListener('click', function () { sfx('click'); resume(); });
    doc.body.appendChild(p);
    state.pauseEl = p;
  }

  function pause() {
    if (state.paused) return;
    state.paused = true;
    doc.body.classList.add('nb-paused');
    var muted = safe(function () { return NB.Audio ? NB.Audio.isMuted() : true; }, true);
    state.autoMuted = !muted;
    if (!muted) {
      sSet(K.AUTOPAUSE, { wasMuted: false });
      safe(function () { NB.Audio.setMuted(true); });
    }
    emit('app:pause', { game: state.activeGame ? state.activeGame.id : null });
    showPauseOverlay();
  }

  function resume() {
    if (!state.paused) return;
    state.paused = false;
    doc.body.classList.remove('nb-paused');
    if (state.autoMuted) {
      safe(function () { NB.Audio.setMuted(false); });
      sRemove(K.AUTOPAUSE);
      state.autoMuted = false;
    }
    if (state.pauseEl) {
      if (state.pauseEl.parentNode) state.pauseEl.parentNode.removeChild(state.pauseEl);
      state.pauseEl = null;
    }
    emit('app:resume', { game: state.activeGame ? state.activeGame.id : null });
  }

  /* ------------------------------------------------------------------------
   * Глобальные обработчики
   * ---------------------------------------------------------------------- */
  function bindGlobal() {
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) pause();
    });
    window.addEventListener('pagehide', function () { pause(); });

    // Запрет масштабирования жестами и контекстного меню (кроме полей ввода)
    doc.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    doc.addEventListener('contextmenu', function (e) {
      var t = e.target;
      if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) e.preventDefault();
    });

    function reportError(e) {
      console.error('[NB.Main]', e);
      var now = Date.now();
      if (now - state.lastErrToast < 5000) return;
      state.lastErrToast = now;
      toast('Что-то пошло не так. Попробуй ещё раз', 'error');
    }
    window.addEventListener('error', function (ev) { reportError(ev.error || ev.message); });
    window.addEventListener('unhandledrejection', function (ev) { reportError(ev.reason); });
  }

  function bindAppEvents() {
    NB.Events.on('round:settled', onRoundSettled);
    NB.Events.on('achievement:unlocked', announceAchievement);
    NB.Events.on('achievement:unlock', announceAchievement);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!secure) return;
    navigator.serviceWorker.register('sw.js').catch(function (e) { warn('Service Worker не зарегистрирован', e); });
  }

  /* ------------------------------------------------------------------------
   * Запуск
   * ---------------------------------------------------------------------- */

  /* ------------------------------------------------------------------------
   * Шапка из index.html: баланс, уровень, кнопка звука
   * ---------------------------------------------------------------------- */
  function syncHeader() {
    var b = doc.getElementById('header-balance');
    if (b) b.textContent = fmt(balance());
    var i = safe(function () { return NB.Levels.getInfo(); }, null);
    if (!i) return;
    var n = doc.getElementById('header-level-num');
    var t = doc.getElementById('header-level-title');
    var f = doc.getElementById('header-xp-fill');
    if (n) n.textContent = i.level;
    if (t) t.textContent = i.title || '';
    if (f) {
      var xp = +i.xp || 0, total = xp + (+i.xpToNext || 0);
      f.style.width = (total > 0 ? Math.round(xp / total * 100) : 100) + '%';
    }
  }

  function bindHeader() {
    var btn = doc.getElementById('btn-sound');
    var ico = doc.getElementById('btn-sound-icon');
    function paintSound() {
      var m = safe(function () { return NB.Audio.isMuted(); }, false);
      if (ico) ico.textContent = m ? '🔇' : '🔊';
      if (btn) btn.setAttribute('aria-pressed', m ? 'true' : 'false');
    }
    if (btn) {
      btn.addEventListener('click', function () {
        var m = safe(function () { return NB.Audio.isMuted(); }, false);
        safe(function () { NB.Audio.setMuted(!m); });
        if (m) sfx('click');
        paintSound();
      });
    }
    ['balance:change', 'round:settled', 'level:up'].forEach(function (name) {
      safe(function () { NB.Events.on(name, syncHeader); });
    });
    syncHeader();
    paintSound();
  }

  async function boot() {
    if (state.booted) return;
    state.booted = true;

    injectStyles();
    ensureRoot();
    applyTheme('violet');
    showSplash();
    bindGlobal();

    var t0 = Date.now();
    try {
      await initModules();
    } catch (e) {
      console.error('[NB.Main]', e);
      fatal(e && e.message ? e.message : String(e));
      return;
    }

    // Модули готовы — применяем сохранённую тему, настройки звука
    applyTheme(sGet(K.THEME, 'violet'));
    recoverAutoMute();
    restoreAudio();
    bindAppEvents();
    bindHeader();

    splashProgress(0.85, 'Готовим экраны…');
    try {
      registerScreens();
    } catch (e2) {
      console.error('[NB.Main]', e2);
      fatal('Ошибка регистрации экранов: ' + (e2 && e2.message ? e2.message : e2));
      return;
    }
    registerSW();

    await sleep(Math.max(0, CONFIG.splashMinMs - (Date.now() - t0)));
    splashProgress(1, 'Готово!');
    await sleep(150);
    await hideSplash();

    var firstRun = !sGet(K.FIRST_RUN, false);
    if (firstRun) {
      try { await runFirstRun(); } catch (e3) { warn('Ошибка первого запуска', e3); }
    }

    NB.Router.go('lobby');
    emit('app:ready', { version: VERSION, firstRun: firstRun });

    if (!firstRun) {
      setTimeout(function () { checkBonuses().catch(warn); }, 500);
    }
  }

  /* ------------------------------------------------------------------------
   * Публичный API
   * ---------------------------------------------------------------------- */
  NB.Main = {
    version: VERSION,
    config: CONFIG,
    boot: boot,
    pause: pause,
    resume: resume,
    applyTheme: function (name) { return applyTheme(name, true); },
    getTheme: getTheme,
    getPlayerName: getPlayerName,
    setPlayerName: setPlayerName,
    showRules: showRules,
    openDialog: openDialog,
    runTour: runTour,
    checkBonuses: checkBonuses,
    claimDaily: claimDaily
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();