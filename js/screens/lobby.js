/* js/screens/lobby.js — Главный экран NaebBet: лобби, бонус, каталог игр */
(function () {
  'use strict';

  var NB = (window.NB = window.NB || {});

  // ---------- Константы ----------
  var DAY = 24 * 60 * 60 * 1000;
  var KEY_BONUS = 'nb_daily_bonus';
  var KEY_FAVS = 'nb_favorites';
  var KEY_LAST = 'nb_last_game';
  var KEY_PROFILE = 'nb_profile';
  var STYLE_ID = 'nb-lobby-style';

  var CATEGORIES = [
    { id: 'all', label: 'Все', icon: '🎰' },
    { id: 'cards', label: 'Карточные', icon: '🃏' },
    { id: 'slots', label: 'Слоты', icon: '🍒' },
    { id: 'dice', label: 'Кости', icon: '🎲' },
    { id: 'fast', label: 'Быстрые', icon: '⚡' },
    { id: 'arcade', label: 'Аркады', icon: '🕹️' }
  ];

  // Нормализация названий категорий (рус/англ)
  var CAT_ALIASES = {
    cards: 'cards', card: 'cards', 'карточные': 'cards', 'карты': 'cards', 'карточная': 'cards',
    slots: 'slots', slot: 'slots', 'слоты': 'slots', 'слот': 'slots',
    dice: 'dice', 'кости': 'dice', 'кость': 'dice',
    fast: 'fast', quick: 'fast', 'быстрые': 'fast', 'быстрая': 'fast',
    arcade: 'arcade', 'аркады': 'arcade', 'аркада': 'arcade'
  };

  // ---------- Состояние экрана ----------
  var S = null; // создаётся в mount, обнуляется в unmount

  // ---------- Утилиты ----------
  function safe(fn, def) {
    try {
      var r = fn();
      return r === undefined ? def : r;
    } catch (e) {
      return def;
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fmt(n) {
    if (NB.UI && NB.UI.formatMoney) return NB.UI.formatMoney(n);
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function normCat(c) {
    return CAT_ALIASES[String(c || '').toLowerCase()] || 'fast';
  }

  function catInfo(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[0];
  }

  // RTP может быть 0.96 или 96
  function rtpText(rtp) {
    var v = Number(rtp);
    if (!isFinite(v) || v <= 0) return null;
    if (v <= 1.5) v *= 100;
    return (Math.round(v * 10) / 10).toString().replace('.', ',') + '%';
  }

  function allGames() {
    var list = safe(function () { return NB.Games.getAll(); }, []);
    return Array.isArray(list) ? list : [];
  }

  function getGame(id) {
    return safe(function () { return NB.Games.get(id); }, null);
  }

  function timeAgo(ts) {
    var d = Date.now() - ts;
    if (d < 0) d = 0;
    var m = Math.floor(d / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' ч назад';
    return Math.floor(h / 24) + ' дн назад';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function greeting() {
    var h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }

  // ---------- Избранное ----------
  function getFavs() {
    var f = safe(function () { return NB.Storage.get(KEY_FAVS, []); }, []);
    return Array.isArray(f) ? f : [];
  }

  function toggleFav(id) {
    var f = getFavs();
    var i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.push(id);
    safe(function () { NB.Storage.set(KEY_FAVS, f); });
    return i < 0;
  }

  // ---------- Ежедневный бонус ----------
  function getBonusState() {
    var b = safe(function () { return NB.Storage.get(KEY_BONUS, null); }, null);
    if (!b || typeof b !== 'object') b = { last: 0, streak: 0 };
    return { last: Number(b.last) || 0, streak: Number(b.streak) || 0 };
  }

  function nextStreak(b, now) {
    if (b.last && now - b.last < 2 * DAY) return Math.min(b.streak + 1, 7);
    return 1;
  }

  function bonusAmount(streak) {
    return 500 + 250 * (Math.min(streak, 7) - 1); // 500 … 2000
  }

  function claimBonus() {
    var now = Date.now();
    var b = getBonusState();
    if (b.last && now - b.last < DAY) {
      if (NB.Audio) NB.Audio.play('error');
      return;
    }
    var st = nextStreak(b, now);
    var amount = bonusAmount(st);
    safe(function () { NB.Storage.set(KEY_BONUS, { last: now, streak: st }); });
    safe(function () { NB.Wallet.add(amount, 'daily_bonus'); });
    safe(function () { NB.Levels.addXp(20); });
    if (NB.Audio) NB.Audio.play('coin');
    if (NB.UI) NB.UI.toast('Бонус дня: +' + fmt(amount) + ' NB 🎁 (серия: ' + st + ')', 'success');
    safe(function () { NB.Achievements.check(); });
    renderBonus();
  }

  // ---------- Стили ----------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.lb{--lb-p:#a855f7;--lb-g:#fbbf24;--lb-bg:#0b0716;--lb-card:#161028;--lb-line:#2a1f4a;--lb-txt:#f3eefc;--lb-dim:#9a8fb8;',
      'color:var(--lb-txt);background:radial-gradient(120% 60% at 50% 0%,#1d0f3d 0%,var(--lb-bg) 60%);min-height:100%;',
      'padding:12px 12px calc(24px + env(safe-area-inset-bottom,0px));box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-tap-highlight-color:transparent;}',
      '.lb *{box-sizing:border-box;}',
      '.lb button{font-family:inherit;color:inherit;cursor:pointer;}',
      '.lb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;}',
      '.lb-hello{font-size:18px;font-weight:700;line-height:1.2;}',
      '.lb-sub{font-size:12px;color:var(--lb-dim);margin-top:2px;}',
      '.lb-bal{text-align:right;}',
      '.lb-bal-v{font-size:22px;font-weight:800;color:var(--lb-g);text-shadow:0 0 12px rgba(251,191,36,.55);}',
      '.lb-bal-l{font-size:11px;color:var(--lb-dim);}',
      '.lb-xp{height:6px;border-radius:3px;background:#241a42;overflow:hidden;margin:0 0 14px;}',
      '.lb-xp>i{display:block;height:100%;background:linear-gradient(90deg,var(--lb-p),var(--lb-g));border-radius:3px;}',
      '.lb-quick{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}',
      '.lb-qbtn{min-height:48px;border-radius:14px;border:1px solid var(--lb-p);background:rgba(168,85,247,.12);font-size:16px;font-weight:700;',
      'box-shadow:0 0 14px rgba(168,85,247,.25) inset;}',
      '.lb-qbtn:active{transform:scale(.97);}',
      '.lb-bonus{border-radius:18px;padding:14px;margin-bottom:16px;border:1px solid var(--lb-g);',
      'background:linear-gradient(135deg,rgba(251,191,36,.16),rgba(168,85,247,.16));box-shadow:0 0 18px rgba(251,191,36,.2);}',
      '.lb-bonus-top{display:flex;align-items:center;gap:12px;}',
      '.lb-bonus-ic{font-size:36px;}',
      '.lb-bonus-t{font-weight:800;font-size:16px;}',
      '.lb-bonus-d{font-size:13px;color:var(--lb-dim);margin-top:2px;}',
      '.lb-days{display:flex;gap:5px;margin:12px 0;}',
      '.lb-day{flex:1;height:8px;border-radius:4px;background:#2a1f4a;}',
      '.lb-day.on{background:var(--lb-g);box-shadow:0 0 8px rgba(251,191,36,.7);}',
      '.lb-claim{width:100%;min-height:48px;border-radius:14px;border:0;font-size:17px;font-weight:800;color:#1a0f00;',
      'background:linear-gradient(180deg,#fde68a,var(--lb-g));box-shadow:0 0 16px rgba(251,191,36,.5);}',
      '.lb-claim[disabled]{background:#2a1f4a;color:var(--lb-dim);box-shadow:none;cursor:default;}',
      '.lb-sec{margin-bottom:18px;}',
      '.lb-sec-t{font-size:16px;font-weight:800;margin:0 0 10px;display:flex;align-items:center;gap:6px;}',
      '.lb-row{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;}',
      '.lb-row .lb-card{flex:0 0 138px;scroll-snap-align:start;}',
      '.lb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
      '.lb-card{position:relative;min-height:116px;border-radius:16px;padding:12px 10px 10px;background:var(--lb-card);border:1px solid var(--lb-line);',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;user-select:none;}',
      '.lb-card:active{transform:scale(.97);border-color:var(--lb-p);box-shadow:0 0 14px rgba(168,85,247,.5);}',
      '.lb-card-ic{font-size:36px;line-height:1;}',
      '.lb-card-n{font-weight:700;font-size:14px;line-height:1.2;}',
      '.lb-card-m{font-size:11px;color:var(--lb-dim);}',
      '.lb-rtp{display:inline-block;padding:2px 7px;border-radius:9px;font-size:11px;font-weight:700;color:var(--lb-g);',
      'border:1px solid rgba(251,191,36,.5);background:rgba(251,191,36,.1);}',
      '.lb-fav{position:absolute;top:2px;right:2px;width:44px;height:44px;border:0;background:transparent;font-size:20px;line-height:1;}',
      '.lb-badge-new{position:absolute;top:8px;left:8px;font-size:10px;font-weight:800;padding:2px 6px;border-radius:8px;background:var(--lb-p);color:#fff;}',
      '.lb-cont{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;border-radius:16px;padding:10px 14px;border:1px solid var(--lb-p);',
      'background:linear-gradient(135deg,rgba(168,85,247,.25),rgba(168,85,247,.06));text-align:left;}',
      '.lb-cont-ic{font-size:34px;}',
      '.lb-cont-t{font-weight:800;font-size:16px;}',
      '.lb-cont-s{font-size:12px;color:var(--lb-dim);}',
      '.lb-cont-go{margin-left:auto;font-size:22px;color:var(--lb-g);}',
      '.lb-feed{display:flex;flex-direction:column;gap:6px;}',
      '.lb-fi{display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 10px;border-radius:12px;background:var(--lb-card);border:1px solid var(--lb-line);}',
      '.lb-fi-ic{font-size:22px;}',
      '.lb-fi-main{flex:1;min-width:0;}',
      '.lb-fi-n{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.lb-fi-t{font-size:11px;color:var(--lb-dim);}',
      '.lb-fi-v{text-align:right;font-weight:800;color:var(--lb-g);font-size:14px;}',
      '.lb-fi-x{font-size:11px;color:var(--lb-p);font-weight:700;}',
      '.lb-empty{color:var(--lb-dim);font-size:13px;padding:10px 4px;}',
      '.lb-search{width:100%;min-height:46px;border-radius:14px;border:1px solid var(--lb-line);background:var(--lb-card);color:var(--lb-txt);',
      'font-size:16px;padding:0 14px;outline:none;margin-bottom:10px;}',
      '.lb-search:focus{border-color:var(--lb-p);box-shadow:0 0 10px rgba(168,85,247,.5);}',
      '.lb-chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:10px;-webkit-overflow-scrolling:touch;}',
      '.lb-chip{flex:0 0 auto;min-height:44px;padding:0 14px;border-radius:22px;border:1px solid var(--lb-line);background:var(--lb-card);font-size:14px;font-weight:700;white-space:nowrap;}',
      '.lb-chip.on{border-color:var(--lb-p);background:rgba(168,85,247,.3);box-shadow:0 0 10px rgba(168,85,247,.5);}'
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- Карточка игры ----------
  function gameCard(g, opts) {
    opts = opts || {};
    var card = el('div', 'lb-card');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-act', 'play');
    card.setAttribute('data-id', g.id);

    if (opts.isNew) card.appendChild(el('span', 'lb-badge-new', 'NEW'));

    var fav = el('button', 'lb-fav', getFavs().indexOf(g.id) >= 0 ? '❤️' : '🤍');
    fav.setAttribute('type', 'button');
    fav.setAttribute('data-act', 'fav');
    fav.setAttribute('data-id', g.id);
    fav.setAttribute('aria-label', 'В избранное');
    card.appendChild(fav);

    card.appendChild(el('div', 'lb-card-ic', g.icon || '🎮'));
    card.appendChild(el('div', 'lb-card-n', g.name || g.id));

    var rt = rtpText(g.rtp);
    if (rt) card.appendChild(el('span', 'lb-rtp', 'RTP ' + rt));

    if (g.minBet) card.appendChild(el('div', 'lb-card-m', 'от ' + fmt(g.minBet) + ' NB'));
    return card;
  }

  function fillList(box, games, opts, emptyText) {
    box.innerHTML = '';
    if (!games.length) {
      box.appendChild(el('div', 'lb-empty', emptyText));
      return;
    }
    for (var i = 0; i < games.length; i++) {
      var isNew = opts && opts.newSet && opts.newSet[games[i].id];
      box.appendChild(gameCard(games[i], { isNew: isNew }));
    }
  }

  // ---------- Данные для секций ----------
  function getHistory() {
    var h = safe(function () { return NB.Stats.getHistory({ limit: 300 }); }, []);
    return Array.isArray(h) ? h : [];
  }

  function popularGames(games, hist) {
    var cnt = {};
    for (var i = 0; i < hist.length; i++) {
      var id = hist[i] && hist[i].gameId;
      if (id) cnt[id] = (cnt[id] || 0) + 1;
    }
    var idx = {};
    games.forEach(function (g, i) { idx[g.id] = i; });
    return games.slice().sort(function (a, b) {
      var d = (cnt[b.id] || 0) - (cnt[a.id] || 0);
      return d !== 0 ? d : idx[a.id] - idx[b.id];
    }).slice(0, 6);
  }

  function newGames(games) {
    var flagged = games.filter(function (g) { return g.isNew || g.new; });
    if (flagged.length) return flagged.slice(0, 6);
    return games.slice(-4).reverse();
  }

  function favoriteGames(games) {
    var favs = getFavs();
    var list = games.filter(function (g) { return favs.indexOf(g.id) >= 0; });
    if (!list.length) {
      // Если ничего не отмечено — показываем самую часто играемую игру из статистики
      var f = safe(function () { return NB.Stats.getFavoriteGame(); }, null);
      var id = f && typeof f === 'object' ? (f.gameId || f.id) : f;
      var g = id ? getGame(id) : null;
      if (g) list = [g];
    }
    return list;
  }

  // ---------- Рендер частей ----------
  function renderHeader() {
    if (!S) return;
    var info = safe(function () { return NB.Levels.getInfo(); }, null) || { level: 1, xp: 0, xpToNext: 100, title: 'Новичок' };
    var profile = safe(function () { return NB.Storage.get(KEY_PROFILE, {}); }, {}) || {};
    var name = profile.name || 'игрок';
    S.hello.textContent = greeting() + ', ' + name + '! 👋';
    S.sub.textContent = 'Уровень ' + info.level + ' · ' + (info.title || '');
    var total = (Number(info.xp) || 0) + (Number(info.xpToNext) || 0);
    var pct = total > 0 ? Math.max(2, Math.min(100, ((Number(info.xp) || 0) / total) * 100)) : 0;
    S.xpBar.style.width = pct + '%';
    updateBalance(true);
  }

  function updateBalance(instant) {
    if (!S) return;
    var bal = safe(function () { return NB.Wallet.getBalance(); }, 0);
    var from = S.lastBal;
    S.lastBal = bal;
    if (instant || from === null || from === bal || !(NB.UI && NB.UI.animateNumber)) {
      S.balEl.textContent = fmt(bal);
    } else {
      safe(function () { NB.UI.animateNumber(S.balEl, from, bal, 600); });
    }
  }

  function renderBonus() {
    if (!S) return;
    var now = Date.now();
    var b = getBonusState();
    var ready = !b.last || now - b.last >= DAY;
    var shown = ready ? nextStreak(b, now) : b.streak;
    var amount = bonusAmount(ready ? shown : Math.min(b.streak + 1, 7));

    S.bonusTitle.textContent = ready ? 'Ежедневный бонус готов!' : 'Бонус уже получен';
    if (ready) {
      S.bonusDesc.textContent = '+' + fmt(amount) + ' NB · день серии: ' + shown;
      S.claimBtn.disabled = false;
      S.claimBtn.textContent = '🎁 Забрать +' + fmt(amount);
    } else {
      var left = b.last + DAY - now;
      var s = Math.max(0, Math.floor(left / 1000));
      var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
      S.bonusDesc.textContent = 'Следующий: +' + fmt(amount) + ' NB';
      S.claimBtn.disabled = true;
      S.claimBtn.textContent = '⏳ Через ' + pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss);
    }
    // Индикаторы серии из 7 дней
    var dots = S.days.children;
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = 'lb-day' + (i < shown ? ' on' : '');
    }
  }

  function renderContinue() {
    if (!S) return;
    S.contBox.innerHTML = '';
    var id = safe(function () { return NB.Storage.get(KEY_LAST, null); }, null);
    var g = id ? getGame(id) : null;
    if (!g) {
      S.contSec.style.display = 'none';
      return;
    }
    S.contSec.style.display = '';
    var btn = el('button', 'lb-cont');
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-act', 'play');
    btn.setAttribute('data-id', g.id);
    btn.appendChild(el('div', 'lb-cont-ic', g.icon || '🎮'));
    var mid = el('div');
    mid.appendChild(el('div', 'lb-cont-t', g.name || g.id));
    mid.appendChild(el('div', 'lb-cont-s', 'Вернуться в игру'));
    btn.appendChild(mid);
    btn.appendChild(el('div', 'lb-cont-go', '▶'));
    S.contBox.appendChild(btn);
  }

  function renderFeed(hist) {
    if (!S) return;
    S.feedBox.innerHTML = '';
    var wins = [];
    for (var i = 0; i < hist.length; i++) {
      var r = hist[i];
      if (!r || !(r.bet > 0) || !(r.payout > r.bet)) continue;
      var mult = r.payout / r.bet;
      if (mult >= 5 || r.payout - r.bet >= 2000) wins.push(r);
    }
    wins.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    wins = wins.slice(0, 10);

    if (!wins.length) {
      S.feedBox.appendChild(el('div', 'lb-empty', 'Пока нет крупных выигрышей — стань первым! 🍀'));
      return;
    }
    wins.forEach(function (r) {
      var g = getGame(r.gameId);
      var row = el('div', 'lb-fi');
      row.appendChild(el('div', 'lb-fi-ic', g ? g.icon : '🎰'));
      var main = el('div', 'lb-fi-main');
      main.appendChild(el('div', 'lb-fi-n', g ? g.name : String(r.gameId)));
      main.appendChild(el('div', 'lb-fi-t', r.ts ? timeAgo(r.ts) : ''));
      row.appendChild(main);
      var v = el('div', 'lb-fi-v');
      v.appendChild(document.createTextNode('+' + fmt(r.payout - r.bet)));
      v.appendChild(el('div', 'lb-fi-x', '×' + (Math.round((r.payout / r.bet) * 10) / 10)));
      row.appendChild(v);
      S.feedBox.appendChild(row);
    });
  }

  function renderLists() {
    if (!S) return;
    var games = allGames();
    var hist = getHistory();
    var newList = newGames(games);
    var newSet = {};
    newList.forEach(function (g) { newSet[g.id] = true; });

    renderContinue();
    fillList(S.favBox, favoriteGames(games), null, 'Нажми 🤍 на карточке игры, чтобы добавить её сюда');
    fillList(S.popBox, popularGames(games, hist), { newSet: newSet }, 'Игры пока не добавлены');
    fillList(S.newBox, newList, { newSet: newSet }, 'Новинок пока нет');
    renderFeed(hist);
    renderCatalog();
  }

  function renderChips() {
    S.chips.innerHTML = '';
    CATEGORIES.forEach(function (c) {
      var b = el('button', 'lb-chip' + (S.filter === c.id ? ' on' : ''), c.icon + ' ' + c.label);
      b.setAttribute('type', 'button');
      b.setAttribute('data-act', 'filter');
      b.setAttribute('data-cat', c.id);
      S.chips.appendChild(b);
    });
  }

  function renderCatalog() {
    if (!S) return;
    var q = S.query.trim().toLowerCase();
    var list = allGames().filter(function (g) {
      if (S.filter !== 'all' && normCat(g.category) !== S.filter) return false;
      if (q) {
        var hay = ((g.name || '') + ' ' + (g.description || '') + ' ' + (g.id || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    S.gridBox.innerHTML = '';
    if (!list.length) {
      S.gridBox.style.display = 'block';
      S.gridBox.appendChild(el('div', 'lb-empty', 'Ничего не найдено 🔍'));
      return;
    }
    S.gridBox.style.display = '';
    list.forEach(function (g) { S.gridBox.appendChild(gameCard(g)); });
  }

  // ---------- Построение каркаса ----------
  function section(title, bodyClass) {
    var sec = el('section', 'lb-sec');
    sec.appendChild(el('h2', 'lb-sec-t', title));
    var body = el('div', bodyClass);
    sec.appendChild(body);
    return { sec: sec, body: body };
  }

  function build(container) {
    var root = el('div', 'lb');

    // Шапка
    var head = el('div', 'lb-head');
    var left = el('div');
    S.hello = el('div', 'lb-hello');
    S.sub = el('div', 'lb-sub');
    left.appendChild(S.hello);
    left.appendChild(S.sub);
    var bal = el('div', 'lb-bal');
    S.balEl = el('div', 'lb-bal-v', '0');
    bal.appendChild(S.balEl);
    bal.appendChild(el('div', 'lb-bal-l', 'NB-монет'));
    head.appendChild(left);
    head.appendChild(bal);
    root.appendChild(head);

    var xp = el('div', 'lb-xp');
    S.xpBar = el('i');
    xp.appendChild(S.xpBar);
    root.appendChild(xp);

    // Быстрые кнопки
    var quick = el('div', 'lb-quick');
    [['👤 Профиль', 'profile'], ['🏦 Банк', 'bank']].forEach(function (p) {
      var b = el('button', 'lb-qbtn', p[0]);
      b.setAttribute('type', 'button');
      b.setAttribute('data-act', 'nav');
      b.setAttribute('data-to', p[1]);
      quick.appendChild(b);
    });
    root.appendChild(quick);

    // Бонус
    var bonus = el('div', 'lb-bonus');
    var top = el('div', 'lb-bonus-top');
    top.appendChild(el('div', 'lb-bonus-ic', '🎁'));
    var info = el('div');
    S.bonusTitle = el('div', 'lb-bonus-t');
    S.bonusDesc = el('div', 'lb-bonus-d');
    info.appendChild(S.bonusTitle);
    info.appendChild(S.bonusDesc);
    top.appendChild(info);
    bonus.appendChild(top);
    S.days = el('div', 'lb-days');
    for (var i = 0; i < 7; i++) S.days.appendChild(el('div', 'lb-day'));
    bonus.appendChild(S.days);
    S.claimBtn = el('button', 'lb-claim');
    S.claimBtn.setAttribute('type', 'button');
    S.claimBtn.setAttribute('data-act', 'claim');
    bonus.appendChild(S.claimBtn);
    root.appendChild(bonus);

    // Продолжить
    var c = section('▶️ Продолжить', 'lb-contbox');
    S.contSec = c.sec;
    S.contBox = c.body;
    root.appendChild(c.sec);

    // Любимые / Популярные / Новые
    var f = section('❤️ Любимые', 'lb-row');
    S.favBox = f.body;
    root.appendChild(f.sec);

    var p = section('🔥 Популярные', 'lb-row');
    S.popBox = p.body;
    root.appendChild(p.sec);

    var n = section('✨ Новые', 'lb-row');
    S.newBox = n.body;
    root.appendChild(n.sec);

    // Лента крупных выигрышей
    var fe = section('🏆 Крупные выигрыши', 'lb-feed');
    S.feedBox = fe.body;
    root.appendChild(fe.sec);

    // Каталог
    var cat = el('section', 'lb-sec');
    cat.appendChild(el('h2', 'lb-sec-t', '🎰 Каталог игр'));
    S.search = el('input', 'lb-search');
    S.search.setAttribute('type', 'search');
    S.search.setAttribute('placeholder', 'Поиск игры…');
    S.search.setAttribute('autocomplete', 'off');
    S.search.setAttribute('aria-label', 'Поиск игры');
    cat.appendChild(S.search);
    S.chips = el('div', 'lb-chips');
    cat.appendChild(S.chips);
    S.gridBox = el('div', 'lb-grid');
    cat.appendChild(S.gridBox);
    root.appendChild(cat);

    container.appendChild(root);
    S.root = root;
  }

  // ---------- Действия ----------
  function openGame(id) {
    var g = getGame(id);
    if (!g) {
      if (NB.UI) NB.UI.toast('Игра недоступна', 'error');
      return;
    }
    safe(function () { NB.Storage.set(KEY_LAST, id); });
    if (NB.Audio) NB.Audio.play('click');
    safe(function () { NB.Router.go('game', { id: id, gameId: id }); });
  }

  function onClick(e) {
    if (!S) return;
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t || !S.root.contains(t)) return;
    var act = t.getAttribute('data-act');

    if (act === 'fav') {
      e.stopPropagation();
      var id = t.getAttribute('data-id');
      var added = toggleFav(id);
      if (NB.Audio) NB.Audio.play('click');
      if (NB.UI) NB.UI.toast(added ? 'Добавлено в любимые ❤️' : 'Убрано из любимых', 'info');
      renderLists();
    } else if (act === 'play') {
      openGame(t.getAttribute('data-id'));
    } else if (act === 'claim') {
      claimBonus();
    } else if (act === 'nav') {
      if (NB.Audio) NB.Audio.play('click');
      safe(function () { NB.Router.go(t.getAttribute('data-to')); });
    } else if (act === 'filter') {
      S.filter = t.getAttribute('data-cat');
      if (NB.Audio) NB.Audio.play('click');
      renderChips();
      renderCatalog();
    }
  }

  function onKey(e) {
    if (!S) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute &&
        e.target.getAttribute('data-act') === 'play' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      openGame(e.target.getAttribute('data-id'));
    }
  }

  function onSearch() {
    if (!S) return;
    S.query = S.search.value || '';
    renderCatalog();
  }

  // ---------- Жизненный цикл экрана ----------
  function mount(container, params) {
    if (S) unmount();
    injectStyle();
    container.innerHTML = '';

    S = {
      container: container,
      filter: 'all',
      query: '',
      lastBal: null,
      timer: null,
      onBalance: null,
      onSettled: null
    };

    build(container);
    renderChips();
    renderHeader();
    renderBonus();
    renderLists();

    S.root.addEventListener('click', onClick);
    S.root.addEventListener('keydown', onKey);
    S.search.addEventListener('input', onSearch);

    // Секундный таймер бонуса
    S.timer = setInterval(renderBonus, 1000);

    // События кошелька и раундов
    S.onBalance = function () { updateBalance(false); };
    S.onSettled = function (data) {
      if (data && data.gameId) safe(function () { NB.Storage.set(KEY_LAST, data.gameId); });
      renderHeader();
      renderLists();
    };
    if (NB.Events) {
      NB.Events.on('balance:change', S.onBalance);
      NB.Events.on('round:settled', S.onSettled);
    }
  }

  function unmount() {
    if (!S) return;
    if (S.timer) clearInterval(S.timer);
    if (NB.Events) {
      if (S.onBalance) NB.Events.off('balance:change', S.onBalance);
      if (S.onSettled) NB.Events.off('round:settled', S.onSettled);
    }
    if (S.root) {
      S.root.removeEventListener('click', onClick);
      S.root.removeEventListener('keydown', onKey);
    }
    if (S.search) S.search.removeEventListener('input', onSearch);
    if (S.container) S.container.innerHTML = '';
    S = null;
  }

  // ---------- Публичный модуль ----------
  NB.Lobby = {
    mount: mount,
    unmount: unmount
  };

  if (NB.Router && NB.Router.register) {
    NB.Router.register('lobby', { mount: mount, unmount: unmount });
  }
})();