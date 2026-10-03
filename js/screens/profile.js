/* ============================================================
 * NaebBet — js/screens/profile.js
 * Экран профиля: имя, аватар, уровень, баланс, вся статистика,
 * график баланса за 30 дней (canvas), таблица по играм,
 * сетка достижений, переход к истории.
 * ============================================================ */
(function () {
  'use strict';

  var NB = (window.NB = window.NB || {});

  // ---------- Константы ----------
  var SCREEN_ID = 'profile';
  var STYLE_ID = 'nb-profile-style';
  var KEY_NAME = 'nb_profile_name';
  var KEY_AVATAR = 'nb_profile_avatar';
  var DEFAULT_NAME = 'Игрок';
  var DEFAULT_AVATAR = '😎';
  var DAYS = 30;
  var AVATARS = [
    '😎', '🤑', '😈', '🦊', '🐯', '🦁', '🐺', '🐲',
    '👑', '💎', '🎰', '🃏', '🍀', '🔥', '⚡', '🚀',
    '🤖', '👽', '🦄', '🐼', '🐸', '🦅', '🎩', '🕶️'
  ];

  // ---------- Состояние экрана ----------
  var root = null;          // корневой элемент экрана
  var els = {};             // ссылки на DOM-элементы
  var mounted = false;
  var lastBalance = null;   // для анимации баланса
  var chartData = null;     // данные графика
  var chartSel = -1;        // выбранная точка графика
  var onBalance = null;
  var onSettled = null;
  var onResize = null;
  var refreshTimer = null;
  var pickerOpen = false;

  // ---------- Утилиты ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(v, def) {
    v = Number(v);
    return isFinite(v) ? v : (def || 0);
  }

  // Берём первое числовое поле из списка возможных имён
  function pickNum(obj, names) {
    if (!obj) return null;
    for (var i = 0; i < names.length; i++) {
      var v = obj[names[i]];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return null;
  }

  function money(n) {
    n = Math.round(num(n));
    if (NB.UI && typeof NB.UI.formatMoney === 'function') {
      try { return NB.UI.formatMoney(n); } catch (e) { /* упадём на запасной вариант */ }
    }
    return n.toLocaleString('ru-RU');
  }

  function signed(n) {
    n = Math.round(num(n));
    return (n > 0 ? '+' : '') + money(n);
  }

  function pct(n) {
    return (Math.round(num(n) * 10) / 10) + '%';
  }

  function safe(fn, def) {
    try { var r = fn(); return r === undefined ? def : r; } catch (e) { return def; }
  }

  function toast(text, type) {
    if (NB.UI && NB.UI.toast) NB.UI.toast(text, type || 'info');
  }

  function sfx(name) {
    if (NB.Audio && NB.Audio.play) safe(function () { NB.Audio.play(name); });
  }

  function fmtDay(d) {
    var dd = d.getDate(), mm = d.getMonth() + 1;
    return (dd < 10 ? '0' : '') + dd + '.' + (mm < 10 ? '0' : '') + mm;
  }

  function gameInfo(id) {
    var g = NB.Games && NB.Games.get ? safe(function () { return NB.Games.get(id); }, null) : null;
    return {
      id: id,
      name: g && g.name ? g.name : String(id),
      icon: g && g.icon ? g.icon : '🎲'
    };
  }

  // ---------- Стили ----------
  var CSS = [
    '.pf{padding:12px 12px 90px;color:#eee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;box-sizing:border-box}',
    '.pf *{box-sizing:border-box}',
    '.pf-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}',
    '.pf-top h1{flex:1;margin:0;font-size:20px;color:#ffd24a;text-shadow:0 0 10px rgba(255,210,74,.5)}',
    '.pf-btn{min-height:44px;min-width:44px;padding:0 16px;border:1px solid #8a2be2;border-radius:12px;background:#1b1230;color:#fff;font-size:15px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}',
    '.pf-btn:active{transform:scale(.97);background:#2a1850}',
    '.pf-btn.gold{border-color:#ffd24a;color:#ffd24a;box-shadow:0 0 12px rgba(255,210,74,.25)}',
    '.pf-btn.wide{width:100%;margin-top:14px}',
    '.pf-card{background:linear-gradient(180deg,#15101f,#0f0b18);border:1px solid #3a2466;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 0 18px rgba(138,43,226,.12)}',
    '.pf-card h2{margin:0 0 10px;font-size:15px;color:#c79bff;letter-spacing:.5px;text-transform:uppercase}',
    '.pf-head{display:flex;gap:12px;align-items:center}',
    '.pf-ava{width:68px;height:68px;min-width:68px;border-radius:50%;border:2px solid #ffd24a;background:#1b1230;font-size:38px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 14px rgba(255,210,74,.4);padding:0;-webkit-tap-highlight-color:transparent}',
    '.pf-ava:active{transform:scale(.95)}',
    '.pf-who{flex:1;min-width:0}',
    '.pf-name{width:100%;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid #5b34a0;background:#0b0813;color:#fff;font-size:18px;font-weight:700;outline:none}',
    '.pf-name:focus{border-color:#ffd24a;box-shadow:0 0 8px rgba(255,210,74,.4)}',
    '.pf-lvl{margin-top:6px;font-size:13px;color:#b9a6d9}',
    '.pf-lvl b{color:#ffd24a}',
    '.pf-bar{height:10px;border-radius:6px;background:#241838;overflow:hidden;margin-top:12px;border:1px solid #3a2466}',
    '.pf-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8a2be2,#ffd24a);box-shadow:0 0 8px #8a2be2;transition:width .6s}',
    '.pf-xp{font-size:12px;color:#9a88b8;margin-top:4px;display:flex;justify-content:space-between}',
    '.pf-bal{margin-top:12px;text-align:center;padding:10px;border-radius:12px;background:#0b0813;border:1px solid #5b34a0}',
    '.pf-bal small{display:block;font-size:12px;color:#9a88b8}',
    '.pf-bal strong{font-size:30px;color:#ffd24a;text-shadow:0 0 12px rgba(255,210,74,.5)}',
    '.pf-picker{display:none;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:12px}',
    '.pf-picker.open{display:grid}',
    '.pf-picker button{min-height:44px;font-size:24px;border-radius:10px;border:1px solid #3a2466;background:#1b1230;cursor:pointer;padding:0;touch-action:manipulation}',
    '.pf-picker button.sel{border-color:#ffd24a;box-shadow:0 0 8px rgba(255,210,74,.5)}',
    '.pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '.pf-stat{background:#0b0813;border:1px solid #2d1d50;border-radius:12px;padding:10px;min-height:62px}',
    '.pf-stat span{display:block;font-size:12px;color:#9a88b8;margin-bottom:4px}',
    '.pf-stat b{font-size:17px;color:#fff;word-break:break-word}',
    '.pf-stat.full{grid-column:1/-1}',
    '.pos{color:#4dff9a!important}',
    '.neg{color:#ff5470!important}',
    '.pf-chart{position:relative;width:100%;height:190px}',
    '.pf-chart canvas{width:100%;height:100%;display:block;touch-action:pan-y}',
    '.pf-note{font-size:12px;color:#7d6c9c;margin-top:6px}',
    '.pf-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '.pf-tbl{width:100%;border-collapse:collapse;font-size:13px;min-width:430px}',
    '.pf-tbl th{text-align:right;color:#9a88b8;font-weight:600;padding:8px 6px;border-bottom:1px solid #3a2466;white-space:nowrap}',
    '.pf-tbl td{text-align:right;padding:10px 6px;border-bottom:1px solid #22163a;white-space:nowrap}',
    '.pf-tbl th:first-child,.pf-tbl td:first-child{text-align:left;position:sticky;left:0;background:#120d1c}',
    '.pf-ach{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.pf-a{background:#0b0813;border:1px solid #ffd24a;border-radius:12px;padding:10px 6px;text-align:center;min-height:96px;box-shadow:0 0 10px rgba(255,210,74,.2)}',
    '.pf-a.lock{border-color:#2d1d50;box-shadow:none;opacity:.55;filter:grayscale(1)}',
    '.pf-a i{display:block;font-style:normal;font-size:30px;line-height:1.2}',
    '.pf-a b{display:block;font-size:12px;margin-top:4px;color:#fff}',
    '.pf-a span{display:block;font-size:10px;margin-top:2px;color:#9a88b8}',
    '.pf-empty{text-align:center;color:#7d6c9c;padding:14px 0;font-size:14px}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function removeStyle() {
    var st = document.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  // ---------- Сбор статистики ----------
  function loadHistory() {
    var h = [];
    if (NB.Stats && NB.Stats.getHistory) {
      h = safe(function () { return NB.Stats.getHistory({ limit: 100000 }); }, []) || [];
    }
    if (!Array.isArray(h)) h = [];
    h = h.filter(function (r) { return r && isFinite(Number(r.ts)); }).map(function (r) {
      return {
        gameId: r.gameId || r.game || 'unknown',
        bet: num(r.bet),
        payout: num(r.payout),
        ts: Number(r.ts)
      };
    });
    h.sort(function (a, b) { return a.ts - b.ts; });
    return h;
  }

  function emptyGame(id) {
    return { id: id, rounds: 0, bet: 0, payout: 0, wins: 0, losses: 0, won: 0, lost: 0, best: 0 };
  }

  function computeStats(hist) {
    var s = {
      rounds: 0, totalBet: 0, totalPayout: 0, wins: 0, losses: 0, pushes: 0,
      won: 0, lost: 0, net: 0, winrate: 0,
      bestWin: 0, bestPayout: 0, maxBet: 0, maxMult: 0,
      bestWinStreak: 0, worstLossStreak: 0, curStreak: 0,
      games: {}, favorite: null, bestGame: null, worstGame: null
    };
    var win = 0, loss = 0;
    hist.forEach(function (r) {
      var g = s.games[r.gameId] || (s.games[r.gameId] = emptyGame(r.gameId));
      var diff = r.payout - r.bet;
      s.rounds++; g.rounds++;
      s.totalBet += r.bet; g.bet += r.bet;
      s.totalPayout += r.payout; g.payout += r.payout;
      if (r.bet > s.maxBet) s.maxBet = r.bet;
      if (r.payout > s.bestPayout) s.bestPayout = r.payout;
      if (r.bet > 0 && r.payout / r.bet > s.maxMult) s.maxMult = r.payout / r.bet;
      if (diff > 0) {
        s.wins++; g.wins++; s.won += diff; g.won += diff;
        if (diff > s.bestWin) s.bestWin = diff;
        if (diff > g.best) g.best = diff;
        win++; loss = 0;
        if (win > s.bestWinStreak) s.bestWinStreak = win;
        s.curStreak = win;
      } else if (diff < 0) {
        s.losses++; g.losses++; s.lost += -diff; g.lost += -diff;
        loss++; win = 0;
        if (loss > s.worstLossStreak) s.worstLossStreak = loss;
        s.curStreak = -loss;
      } else {
        s.pushes++;
        win = 0; loss = 0; s.curStreak = 0;
      }
    });
    s.net = s.totalPayout - s.totalBet;
    s.winrate = s.rounds ? (s.wins / s.rounds) * 100 : 0;

    // Любимая / самая прибыльная / самая убыточная
    var ids = Object.keys(s.games);
    ids.forEach(function (id) {
      var g = s.games[id];
      g.net = g.payout - g.bet;
      g.winrate = g.rounds ? (g.wins / g.rounds) * 100 : 0;
      if (!s.favorite || g.rounds > s.games[s.favorite].rounds) s.favorite = id;
      if (!s.bestGame || g.net > s.games[s.bestGame].net) s.bestGame = id;
      if (!s.worstGame || g.net < s.games[s.worstGame].net) s.worstGame = id;
    });
    if (s.bestGame && s.games[s.bestGame].net <= 0) s.bestGame = null;
    if (s.worstGame && s.games[s.worstGame].net >= 0) s.worstGame = null;

    // Уточняем данными модуля Stats, если они полнее истории
    var g = NB.Stats && NB.Stats.getGlobal ? safe(function () { return NB.Stats.getGlobal(); }, null) : null;
    var gr = pickNum(g, ['rounds', 'totalRounds']);
    if (g && gr !== null && gr > s.rounds) {
      var tb = pickNum(g, ['totalBet', 'bet', 'wagered']);
      var tp = pickNum(g, ['totalPayout', 'payout', 'totalWon']);
      var gw = pickNum(g, ['wins', 'win']);
      var gl = pickNum(g, ['losses', 'loss']);
      s.rounds = gr;
      if (tb !== null) s.totalBet = tb;
      if (tp !== null) { s.totalPayout = tp; }
      if (tb !== null && tp !== null) s.net = tp - tb;
      if (gw !== null) s.wins = gw;
      if (gl !== null) s.losses = gl;
      s.winrate = s.rounds ? (s.wins / s.rounds) * 100 : 0;
    }

    // Серии из Stats.getStreaks()
    var st = NB.Stats && NB.Stats.getStreaks ? safe(function () { return NB.Stats.getStreaks(); }, null) : null;
    if (st) {
      var bw = pickNum(st, ['bestWin', 'maxWin', 'bestWinStreak', 'maxWinStreak']);
      var bl = pickNum(st, ['worstLoss', 'maxLoss', 'worstLossStreak', 'maxLossStreak']);
      if (bw !== null && bw > s.bestWinStreak) s.bestWinStreak = bw;
      if (bl !== null && bl > s.worstLossStreak) s.worstLossStreak = bl;
    }

    // Любимая игра по версии Stats
    var fav = NB.Stats && NB.Stats.getFavoriteGame ? safe(function () { return NB.Stats.getFavoriteGame(); }, null) : null;
    if (fav) {
      var fid = typeof fav === 'string' ? fav : (fav.gameId || fav.id || null);
      if (fid) s.favorite = fid;
    }
    return s;
  }

  // Баланс по дням: восстанавливаем назад от текущего баланса
  function computeSeries(hist) {
    var cur = NB.Wallet && NB.Wallet.getBalance ? num(safe(function () { return NB.Wallet.getBalance(); }, 0)) : 0;
    var points = [];
    var after = cur;
    for (var i = hist.length - 1; i >= 0; i--) {
      points.unshift({ ts: hist[i].ts, after: after });
      after -= (hist[i].payout - hist[i].bet);
    }
    var before0 = hist.length ? after : cur;

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var out = [];
    for (var d = DAYS - 1; d >= 0; d--) {
      var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
      var end = day.getTime() + 86400000 - 1;
      var val = before0;
      if (d === 0) {
        val = cur;
      } else {
        for (var k = 0; k < points.length; k++) {
          if (points[k].ts <= end) val = points[k].after; else break;
        }
      }
      out.push({ date: day, value: Math.max(0, val) });
    }
    return out;
  }

  // ---------- Построение каркаса ----------
  function build(container) {
    root = document.createElement('div');
    root.className = 'pf';
    root.innerHTML =
      '<div class="pf-top">' +
        '<button class="pf-btn" data-act="back" aria-label="Назад">←</button>' +
        '<h1>Профиль</h1>' +
        '<button class="pf-btn gold" data-act="history">📜 История</button>' +
      '</div>' +

      '<div class="pf-card">' +
        '<div class="pf-head">' +
          '<button class="pf-ava" data-act="avatar" aria-label="Выбрать аватар"></button>' +
          '<div class="pf-who">' +
            '<input class="pf-name" type="text" maxlength="16" autocomplete="off" aria-label="Имя игрока">' +
            '<div class="pf-lvl"></div>' +
          '</div>' +
        '</div>' +
        '<div class="pf-picker"></div>' +
        '<div class="pf-bar"><i></i></div>' +
        '<div class="pf-xp"><span class="pf-xp-l"></span><span class="pf-xp-r"></span></div>' +
        '<div class="pf-bal"><small>Баланс</small><strong class="pf-bal-v">0</strong> <span>🪙</span></div>' +
      '</div>' +

      '<div class="pf-card"><h2>📊 Сводка</h2><div class="pf-grid pf-sum"></div></div>' +
      '<div class="pf-card"><h2>🏅 Рекорды и серии</h2><div class="pf-grid pf-rec"></div></div>' +

      '<div class="pf-card"><h2>📈 Баланс за 30 дней</h2>' +
        '<div class="pf-chart"><canvas></canvas></div>' +
        '<div class="pf-note">Коснитесь графика, чтобы увидеть значение за день.</div>' +
      '</div>' +

      '<div class="pf-card"><h2>🎮 По играм</h2><div class="pf-scroll pf-games"></div></div>' +
      '<div class="pf-card"><h2>🏆 Достижения <span class="pf-ach-cnt"></span></h2><div class="pf-ach"></div></div>' +

      '<button class="pf-btn gold wide" data-act="history">📜 Открыть историю игр</button>';

    container.appendChild(root);

    els.back = root.querySelector('[data-act="back"]');
    els.avatar = root.querySelector('.pf-ava');
    els.name = root.querySelector('.pf-name');
    els.lvl = root.querySelector('.pf-lvl');
    els.picker = root.querySelector('.pf-picker');
    els.bar = root.querySelector('.pf-bar i');
    els.xpL = root.querySelector('.pf-xp-l');
    els.xpR = root.querySelector('.pf-xp-r');
    els.bal = root.querySelector('.pf-bal-v');
    els.sum = root.querySelector('.pf-sum');
    els.rec = root.querySelector('.pf-rec');
    els.chartWrap = root.querySelector('.pf-chart');
    els.canvas = root.querySelector('.pf-chart canvas');
    els.games = root.querySelector('.pf-games');
    els.ach = root.querySelector('.pf-ach');
    els.achCnt = root.querySelector('.pf-ach-cnt');

    // Аватар и имя
    var ava = safe(function () { return NB.Storage.get(KEY_AVATAR, DEFAULT_AVATAR); }, DEFAULT_AVATAR) || DEFAULT_AVATAR;
    var name = safe(function () { return NB.Storage.get(KEY_NAME, DEFAULT_NAME); }, DEFAULT_NAME) || DEFAULT_NAME;
    els.avatar.textContent = ava;
    els.name.value = name;
    buildPicker(ava);

    root.addEventListener('click', onClick);
    els.name.addEventListener('change', saveName);
    els.name.addEventListener('blur', saveName);
    els.name.addEventListener('keydown', onNameKey);
    els.canvas.addEventListener('pointerdown', onChartPointer);
    els.canvas.addEventListener('pointermove', onChartPointer);
    els.canvas.addEventListener('pointerleave', onChartLeave);
    els.canvas.addEventListener('pointercancel', onChartLeave);
  }

  function buildPicker(selected) {
    els.picker.innerHTML = AVATARS.map(function (a) {
      return '<button data-ava="' + esc(a) + '" class="' + (a === selected ? 'sel' : '') + '">' + a + '</button>';
    }).join('');
  }

  // ---------- Обработчики ----------
  function onClick(e) {
    var t = e.target;
    while (t && t !== root && !(t.dataset && (t.dataset.act || t.dataset.ava))) t = t.parentNode;
    if (!t || t === root) return;

    if (t.dataset.ava) {
      setAvatar(t.dataset.ava);
      return;
    }
    var act = t.dataset.act;
    if (act === 'back') {
      sfx('click');
      if (NB.Router && NB.Router.back) NB.Router.back();
    } else if (act === 'history') {
      sfx('click');
      if (NB.Router && NB.Router.go) NB.Router.go('history');
    } else if (act === 'avatar') {
      sfx('click');
      pickerOpen = !pickerOpen;
      els.picker.classList.toggle('open', pickerOpen);
    }
  }

  function setAvatar(a) {
    els.avatar.textContent = a;
    safe(function () { NB.Storage.set(KEY_AVATAR, a); });
    buildPicker(a);
    pickerOpen = false;
    els.picker.classList.remove('open');
    sfx('coin');
    if (NB.Events) NB.Events.emit('profile:change', { name: els.name.value, avatar: a });
  }

  function onNameKey(e) {
    if (e.key === 'Enter') els.name.blur();
  }

  function saveName() {
    var v = String(els.name.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!v) v = DEFAULT_NAME;
    var prev = safe(function () { return NB.Storage.get(KEY_NAME, DEFAULT_NAME); }, DEFAULT_NAME);
    els.name.value = v;
    if (v !== prev) {
      safe(function () { NB.Storage.set(KEY_NAME, v); });
      toast('Имя сохранено', 'success');
      if (NB.Events) NB.Events.emit('profile:change', { name: v, avatar: els.avatar.textContent });
    }
  }

  function chartIndexFromEvent(e) {
    if (!chartData || !chartData.length) return -1;
    var rect = els.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var padL = 8, padR = 8;
    var w = rect.width - padL - padR;
    var i = Math.round(((x - padL) / w) * (chartData.length - 1));
    return Math.max(0, Math.min(chartData.length - 1, i));
  }

  function onChartPointer(e) {
    var i = chartIndexFromEvent(e);
    if (i !== chartSel) {
      chartSel = i;
      drawChart();
    }
  }

  function onChartLeave() {
    chartSel = -1;
    drawChart();
  }

  // ---------- Отрисовка секций ----------
  function renderHeader() {
    var info = NB.Levels && NB.Levels.getInfo ? safe(function () { return NB.Levels.getInfo(); }, null) : null;
    info = info || { level: 1, xp: 0, xpToNext: 100, title: 'Новичок' };
    var xp = num(info.xp), need = num(info.xpToNext);
    var total = xp + need;
    var p = total > 0 ? Math.max(0, Math.min(100, (xp / total) * 100)) : 100;

    els.lvl.innerHTML = 'Уровень <b>' + esc(info.level) + '</b> · ' + esc(info.title || '');
    els.bar.style.width = p + '%';
    els.xpL.textContent = 'XP: ' + Math.round(xp);
    els.xpR.textContent = need > 0 ? 'до след. уровня: ' + Math.round(need) : 'макс. уровень';

    var bal = NB.Wallet && NB.Wallet.getBalance ? num(safe(function () { return NB.Wallet.getBalance(); }, 0)) : 0;
    if (lastBalance === null) lastBalance = 0;
    if (NB.UI && NB.UI.animateNumber && lastBalance !== bal) {
      try {
        NB.UI.animateNumber(els.bal, lastBalance, bal, 700);
      } catch (e) {
        els.bal.textContent = money(bal);
      }
    } else {
      els.bal.textContent = money(bal);
    }
    lastBalance = bal;
  }

  function stat(label, value, cls, full) {
    return '<div class="pf-stat' + (full ? ' full' : '') + '"><span>' + esc(label) + '</span><b' +
      (cls ? ' class="' + cls + '"' : '') + '>' + value + '</b></div>';
  }

  function gameLabel(id, extra) {
    if (!id) return '—';
    var g = gameInfo(id);
    return g.icon + ' ' + esc(g.name) + (extra ? ' <small>' + extra + '</small>' : '');
  }

  function renderSummary(s) {
    els.sum.innerHTML =
      stat('Раундов сыграно', esc(s.rounds)) +
      stat('Винрейт', pct(s.winrate), s.winrate >= 50 ? 'pos' : '') +
      stat('Всего поставлено', money(s.totalBet)) +
      stat('Возвращено на баланс', money(s.totalPayout)) +
      stat('Выиграно', '+' + money(s.won), 'pos') +
      stat('Проиграно', '−' + money(s.lost), 'neg') +
      stat('Чистый результат', signed(s.net), s.net > 0 ? 'pos' : (s.net < 0 ? 'neg' : '')) +
      stat('Победы / поражения', esc(s.wins) + ' / ' + esc(s.losses)) +
      stat('Любимая игра', gameLabel(s.favorite, s.favorite && s.games[s.favorite] ? '(' + s.games[s.favorite].rounds + ' р.)' : ''), '', true) +
      stat('Самая прибыльная', s.bestGame ? gameLabel(s.bestGame, signed(s.games[s.bestGame].net)) : '—', s.bestGame ? 'pos' : '', true) +
      stat('Самая убыточная', s.worstGame ? gameLabel(s.worstGame, signed(s.games[s.worstGame].net)) : '—', s.worstGame ? 'neg' : '', true);
  }

  function renderRecords(s, series) {
    var peak = 0;
    series.forEach(function (p) { if (p.value > peak) peak = p.value; });
    var cur = s.curStreak;
    var curTxt = cur > 0 ? '🔥 ' + cur + ' побед' : (cur < 0 ? '❄️ ' + (-cur) + ' поражений' : '—');
    els.rec.innerHTML =
      stat('Лучшая серия побед', esc(s.bestWinStreak), s.bestWinStreak ? 'pos' : '') +
      stat('Худшая серия поражений', esc(s.worstLossStreak), s.worstLossStreak ? 'neg' : '') +
      stat('Текущая серия', curTxt, cur > 0 ? 'pos' : (cur < 0 ? 'neg' : ''), true) +
      stat('Крупнейший выигрыш', s.bestWin ? '+' + money(s.bestWin) : '—', s.bestWin ? 'pos' : '') +
      stat('Максимальная выплата', s.bestPayout ? money(s.bestPayout) : '—') +
      stat('Максимальная ставка', s.maxBet ? money(s.maxBet) : '—') +
      stat('Лучший множитель', s.maxMult ? '×' + (Math.round(s.maxMult * 100) / 100) : '—') +
      stat('Пик баланса (30 дн.)', money(peak), '', true);
  }

  function renderGames(s) {
    var all = NB.Games && NB.Games.getAll ? safe(function () { return NB.Games.getAll(); }, []) || [] : [];
    var ids = [];
    all.forEach(function (g) { if (g && g.id && ids.indexOf(g.id) < 0) ids.push(g.id); });
    Object.keys(s.games).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });

    if (!ids.length) {
      els.games.innerHTML = '<div class="pf-empty">Пока нет игр</div>';
      return;
    }
    // Сначала самые сыгранные
    ids.sort(function (a, b) {
      return (s.games[b] ? s.games[b].rounds : 0) - (s.games[a] ? s.games[a].rounds : 0);
    });

    var rows = ids.map(function (id) {
      var g = s.games[id] || emptyGame(id);
      if (g.net === undefined) { g.net = 0; g.winrate = 0; }
      var info = gameInfo(id);
      return '<tr>' +
        '<td>' + info.icon + ' ' + esc(info.name) + '</td>' +
        '<td>' + g.rounds + '</td>' +
        '<td>' + money(g.bet) + '</td>' +
        '<td class="' + (g.net > 0 ? 'pos' : (g.net < 0 ? 'neg' : '')) + '">' + (g.rounds ? signed(g.net) : '—') + '</td>' +
        '<td>' + (g.rounds ? pct(g.winrate) : '—') + '</td>' +
        '<td>' + (g.best ? '+' + money(g.best) : '—') + '</td>' +
      '</tr>';
    }).join('');

    els.games.innerHTML =
      '<table class="pf-tbl"><thead><tr>' +
      '<th>Игра</th><th>Раунды</th><th>Ставки</th><th>Итог</th><th>Винрейт</th><th>Лучший</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderAchievements() {
    var all = NB.Achievements && NB.Achievements.getAll ? safe(function () { return NB.Achievements.getAll(); }, []) || [] : [];
    var un = NB.Achievements && NB.Achievements.getUnlocked ? safe(function () { return NB.Achievements.getUnlocked(); }, []) || [] : [];
    var set = {};
    if (Array.isArray(un)) {
      un.forEach(function (u) {
        if (u && typeof u === 'object') { if (u.id) set[u.id] = true; } else if (u != null) set[u] = true;
      });
    }
    if (!Array.isArray(all) || !all.length) {
      els.ach.innerHTML = '<div class="pf-empty" style="grid-column:1/-1">Достижений пока нет</div>';
      els.achCnt.textContent = '';
      return;
    }
    var items = all.map(function (a) {
      return {
        id: a.id,
        title: a.title || a.name || a.id,
        desc: a.desc || a.description || '',
        icon: a.icon || '🏆',
        unlocked: a.unlocked === true || !!set[a.id]
      };
    });
    // Открытые сверху
    items.sort(function (a, b) { return (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0); });
    var cnt = items.filter(function (i) { return i.unlocked; }).length;
    els.achCnt.textContent = '(' + cnt + '/' + items.length + ')';
    els.ach.innerHTML = items.map(function (i) {
      return '<div class="pf-a' + (i.unlocked ? '' : ' lock') + '">' +
        '<i>' + (i.unlocked ? esc(i.icon) : '🔒') + '</i>' +
        '<b>' + esc(i.title) + '</b>' +
        '<span>' + esc(i.desc) + '</span>' +
      '</div>';
    }).join('');
  }

  // ---------- График ----------
  function drawChart() {
    var cv = els.canvas;
    if (!cv || !chartData || !chartData.length) return;
    var rect = els.chartWrap.getBoundingClientRect();
    var W = Math.max(120, Math.floor(rect.width));
    var H = Math.max(120, Math.floor(rect.height));
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) {
      cv.width = Math.floor(W * dpr);
      cv.height = Math.floor(H * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var padL = 8, padR = 8, padT = 24, padB = 22;
    var w = W - padL - padR, h = H - padT - padB;
    var n = chartData.length;

    var min = Infinity, max = -Infinity;
    chartData.forEach(function (p) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    });
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    var span = max - min;
    min -= span * 0.08; max += span * 0.08;
    if (min < 0 && chartData.every(function (p) { return p.value >= 0; })) min = Math.max(min, 0);

    function X(i) { return padL + (n === 1 ? w / 2 : (i * w) / (n - 1)); }
    function Y(v) { return padT + h - ((v - min) / (max - min)) * h; }

    // Сетка
    ctx.strokeStyle = 'rgba(138,43,226,0.18)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) {
      var gy = Math.round(padT + (h * g) / 3) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(W - padR, gy);
      ctx.stroke();
    }

    // Заливка под линией
    var grad = ctx.createLinearGradient(0, padT, 0, padT + h);
    grad.addColorStop(0, 'rgba(180,76,255,0.45)');
    grad.addColorStop(1, 'rgba(180,76,255,0)');
    ctx.beginPath();
    ctx.moveTo(X(0), padT + h);
    chartData.forEach(function (p, i) { ctx.lineTo(X(i), Y(p.value)); });
    ctx.lineTo(X(n - 1), padT + h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Линия
    ctx.beginPath();
    chartData.forEach(function (p, i) {
      if (i === 0) ctx.moveTo(X(i), Y(p.value)); else ctx.lineTo(X(i), Y(p.value));
    });
    ctx.strokeStyle = '#b44cff';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#b44cff';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Подписи осей
    ctx.fillStyle = '#9a88b8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(fmtDay(chartData[0].date), padL, H - 6);
    ctx.textAlign = 'right';
    ctx.fillText(fmtDay(chartData[n - 1].date), W - padR, H - 6);

    // Последняя точка (золотая)
    var last = chartData[n - 1];
    ctx.beginPath();
    ctx.arc(X(n - 1), Y(last.value), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.shadowColor = '#ffd24a';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Выбранная точка / подпись
    var idx = chartSel >= 0 ? chartSel : -1;
    ctx.textBaseline = 'top';
    if (idx >= 0) {
      var p = chartData[idx];
      var px = X(idx), py = Y(p.value);
      ctx.strokeStyle = 'rgba(255,210,74,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, padT + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = px > W / 2 ? 'right' : 'left';
      ctx.fillText(fmtDay(p.date) + ' · ' + money(p.value) + ' 🪙', px > W / 2 ? W - padR : padL, 4);
    } else {
      ctx.fillStyle = '#9a88b8';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('макс ' + money(Math.round(max)), padL, 4);
      ctx.textAlign = 'right';
      ctx.fillText('мин ' + money(Math.max(0, Math.round(min))), W - padR, 4);
    }
  }

  // ---------- Полное обновление данных ----------
  function refresh() {
    if (!mounted) return;
    var hist = loadHistory();
    var s = computeStats(hist);
    var series = computeSeries(hist);
    chartData = series;
    renderHeader();
    renderSummary(s);
    renderRecords(s, series);
    renderGames(s);
    renderAchievements();
    drawChart();
  }

  // Отложенное обновление, чтобы не дёргать экран на каждое событие подряд
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh();
    }, 120);
  }

  // ---------- mount / unmount ----------
  function mount(container) {
    if (mounted) unmount();
    mounted = true;
    lastBalance = null;
    chartSel = -1;
    pickerOpen = false;

    injectStyle();
    container.innerHTML = '';
    build(container);

    // Проверяем достижения перед показом
    if (NB.Achievements && NB.Achievements.check) safe(function () { NB.Achievements.check(); });

    onBalance = function () { scheduleRefresh(); };
    onSettled = function () { scheduleRefresh(); };
    onResize = function () { drawChart(); };

    if (NB.Events) {
      NB.Events.on('balance:change', onBalance);
      NB.Events.on('round:settled', onSettled);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    refresh();
    // Повторная отрисовка графика после раскладки
    setTimeout(function () { if (mounted) drawChart(); }, 60);
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;

    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (NB.Events) {
      if (onBalance) NB.Events.off('balance:change', onBalance);
      if (onSettled) NB.Events.off('round:settled', onSettled);
    }
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    onBalance = onSettled = onResize = null;

    if (root) {
      root.removeEventListener('click', onClick);
      if (els.name) {
        els.name.removeEventListener('change', saveName);
        els.name.removeEventListener('blur', saveName);
        els.name.removeEventListener('keydown', onNameKey);
      }
      if (els.canvas) {
        els.canvas.removeEventListener('pointerdown', onChartPointer);
        els.canvas.removeEventListener('pointermove', onChartPointer);
        els.canvas.removeEventListener('pointerleave', onChartLeave);
        els.canvas.removeEventListener('pointercancel', onChartLeave);
      }
      if (root.parentNode) root.parentNode.removeChild(root);
    }
    root = null;
    els = {};
    chartData = null;
    removeStyle();
  }

  // ---------- Регистрация экрана ----------
  NB.Profile = { mount: mount, unmount: unmount };

  if (NB.Router && NB.Router.register) {
    NB.Router.register(SCREEN_ID, { mount: mount, unmount: unmount });
  }
})();