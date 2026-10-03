/* ==========================================================================
   NaebBet — js/games/blackjack.js
   Блэкджек: 6 колод, Hit/Stand/Double/Split(до 3 раз)/Insurance,
   побочная ставка Perfect Pairs, подсказка базовой стратегии.
   Модуль: NB.Games (id: "blackjack"), правила: NB.Rules.
   ========================================================================== */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};

  // ---------------------------------------------------------------------
  // Константы
  // ---------------------------------------------------------------------
  var GAME_ID = 'blackjack';
  var DECKS = 6;                 // число колод в шузе
  var RESHUFFLE_AT = 0.25;       // перетасовка при остатке 25%
  var MAX_SPLITS = 3;            // до 3 сплитов => максимум 4 руки
  var MIN_BET = 10;
  var MAX_BET = 5000;
  var PP_OPTIONS = [0, 10, 50, 100, 500];
  var PP_PAYOUT = { mixed: 5, colored: 12, perfect: 25 };
  var PP_NAMES = { mixed: 'Смешанная пара', colored: 'Цветная пара', perfect: 'Идеальная пара' };
  var SUITS = [
    { s: '♠', red: false }, { s: '♥', red: true },
    { s: '♦', red: true }, { s: '♣', red: false }
  ];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var STORE_HINT = 'nb_blackjack_hint';
  var STORE_PP = 'nb_blackjack_pp';
  var STYLE_ID = 'nb-bj-style';

  // ---------------------------------------------------------------------
  // Шуз (хранится на уровне модуля — продолжается между заходами в игру)
  // ---------------------------------------------------------------------
  var shoe = [];
  var shoeTotal = DECKS * 52;

  function rankValue(r) {
    if (r === 'A') return 11;
    if (r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
    return parseInt(r, 10);
  }

  function buildShoe() {
    var arr = [];
    for (var d = 0; d < DECKS; d++) {
      for (var si = 0; si < SUITS.length; si++) {
        for (var ri = 0; ri < RANKS.length; ri++) {
          arr.push({ r: RANKS[ri], s: SUITS[si].s, red: SUITS[si].red, v: rankValue(RANKS[ri]) });
        }
      }
    }
    var sh = NB.RNG.shuffle(arr);
    shoe = Array.isArray(sh) ? sh : arr;
  }

  function draw() {
    if (!shoe.length) buildShoe();
    var c = shoe.pop();
    c.fresh = true;
    return c;
  }

  // ---------------------------------------------------------------------
  // Вспомогательные функции
  // ---------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function fmt(n) {
    try { return NB.UI.formatMoney(n); } catch (e) { return String(n); }
  }

  function sfx(name) {
    try { if (NB.Audio) NB.Audio.play(name); } catch (e) { /* звук необязателен */ }
  }

  function toast(text, type) {
    try { NB.UI.toast(text, type || 'info'); } catch (e) { /* ignore */ }
  }

  function cardStr(c) { return c.r + c.s; }

  // Подсчёт руки: туз = 1 или 11
  function evalHand(cards) {
    var t = 0, aces = 0, i;
    for (i = 0; i < cards.length; i++) {
      t += cards[i].v;
      if (cards[i].r === 'A') aces++;
    }
    while (t > 21 && aces > 0) { t -= 10; aces--; }
    return { total: t, soft: aces > 0 };
  }

  function isBlackjack(h) {
    return h.cards.length === 2 && !h.fromSplit && evalHand(h.cards).total === 21;
  }

  function dealerBlackjack(cards) {
    return cards.length === 2 && evalHand(cards).total === 21;
  }

  // Perfect Pairs: две первые карты игрока
  function evalPerfectPairs(a, b) {
    if (a.r !== b.r) return null;
    if (a.s === b.s) return 'perfect';
    if (a.red === b.red) return 'colored';
    return 'mixed';
  }

  // ---------------------------------------------------------------------
  // Базовая стратегия (6 колод, дилер стоит на 17, DAS, сплит до 4 рук)
  // ---------------------------------------------------------------------
  function shouldSplit(pv, u) {
    if (pv === 11 || pv === 8) return true;
    if (pv === 9) return (u >= 2 && u <= 6) || u === 8 || u === 9;
    if (pv === 7) return u <= 7;
    if (pv === 6) return u >= 2 && u <= 6;
    if (pv === 4) return u === 5 || u === 6;
    if (pv === 3 || pv === 2) return u >= 2 && u <= 7;
    return false;
  }

  function recommend(hand, up, canDbl, canSpl) {
    var u = up.v;
    var cards = hand.cards;
    var ev = evalHand(cards);
    var t = ev.total;

    if (canSpl && cards.length === 2 && shouldSplit(cards[0].v, u)) {
      return { a: 'split', text: 'Разделить пару' };
    }

    if (ev.soft && t <= 21) {
      var wantD = false, fallback = 'hit';
      if (t === 13 || t === 14) { wantD = (u === 5 || u === 6); }
      else if (t === 15 || t === 16) { wantD = (u >= 4 && u <= 6); }
      else if (t === 17) { wantD = (u >= 3 && u <= 6); }
      else if (t === 18) {
        if (u >= 3 && u <= 6) { wantD = true; fallback = 'stand'; }
        else if (u === 2 || u === 7 || u === 8) { return { a: 'stand', text: 'Остаться (Stand)' }; }
        else { return { a: 'hit', text: 'Взять карту (Hit)' }; }
      } else { return { a: 'stand', text: 'Остаться (Stand)' }; }
      if (wantD && canDbl) return { a: 'double', text: 'Удвоить (Double)' };
      return fallback === 'stand'
        ? { a: 'stand', text: 'Остаться (Stand)' }
        : { a: 'hit', text: 'Взять карту (Hit)' };
    }

    // Жёсткие руки
    if (t <= 8) return { a: 'hit', text: 'Взять карту (Hit)' };
    if (t === 9) {
      return (u >= 3 && u <= 6 && canDbl) ? { a: 'double', text: 'Удвоить (Double)' } : { a: 'hit', text: 'Взять карту (Hit)' };
    }
    if (t === 10) {
      return (u <= 9 && canDbl) ? { a: 'double', text: 'Удвоить (Double)' } : { a: 'hit', text: 'Взять карту (Hit)' };
    }
    if (t === 11) {
      return (u <= 10 && canDbl) ? { a: 'double', text: 'Удвоить (Double)' } : { a: 'hit', text: 'Взять карту (Hit)' };
    }
    if (t === 12) {
      return (u >= 4 && u <= 6) ? { a: 'stand', text: 'Остаться (Stand)' } : { a: 'hit', text: 'Взять карту (Hit)' };
    }
    if (t >= 13 && t <= 16) {
      return (u <= 6) ? { a: 'stand', text: 'Остаться (Stand)' } : { a: 'hit', text: 'Взять карту (Hit)' };
    }
    return { a: 'stand', text: 'Остаться (Stand)' };
  }

  // ---------------------------------------------------------------------
  // Стили (добавляются при mount, удаляются при unmount)
  // ---------------------------------------------------------------------
  var CSS = [
    '.nb-bj{display:flex;flex-direction:column;gap:8px;min-height:100%;box-sizing:border-box;padding:8px 10px 16px;color:#f3e9ff;background:#0b0618;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent;touch-action:manipulation;-webkit-user-select:none;user-select:none}',
    '.nb-bj *{box-sizing:border-box}',
    '.nb-bj button{font:inherit;color:inherit;border:0;cursor:pointer}',
    '.bj-top{display:flex;align-items:center;gap:8px}',
    '.bj-title{flex:1;font-size:18px;font-weight:800;color:#fbbf24;text-shadow:0 0 10px rgba(251,191,36,.55);text-align:center}',
    '.bj-bal{min-width:96px;text-align:right;font-weight:700;color:#fbbf24;font-size:15px}',
    '.bj-btn{min-height:48px;min-width:48px;padding:0 14px;border-radius:14px;background:#24124a;border:1px solid #7c3aed !important;box-shadow:0 0 10px rgba(168,85,247,.35);font-weight:700;font-size:15px;transition:transform .08s,opacity .2s}',
    '.bj-btn:active{transform:scale(.96)}',
    '.bj-btn[disabled]{opacity:.35;box-shadow:none;cursor:default}',
    '.bj-gold{background:linear-gradient(180deg,#fcd34d,#d97706) !important;color:#1a1000 !important;border-color:#fde68a !important;box-shadow:0 0 14px rgba(251,191,36,.6)}',
    '.bj-btn.rec{outline:3px solid #fbbf24;outline-offset:2px;animation:bjPulse 1s ease-in-out infinite}',
    '@keyframes bjPulse{0%,100%{box-shadow:0 0 6px rgba(251,191,36,.4)}50%{box-shadow:0 0 18px rgba(251,191,36,.95)}}',
    '.bj-tools{display:flex;gap:8px;align-items:center;justify-content:space-between}',
    '.bj-switch{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 12px;border-radius:14px;background:#1a0f36;border:1px solid #4c1d95;font-size:14px;font-weight:600;cursor:pointer}',
    '.bj-switch input{width:22px;height:22px;accent-color:#a855f7}',
    '.bj-table{flex:1;display:flex;flex-direction:column;gap:6px;min-height:320px;padding:10px;border-radius:22px;border:2px solid #7c3aed;background:radial-gradient(ellipse at 50% 25%,#15803d33,#052e16 75%),#052e16;box-shadow:0 0 22px rgba(168,85,247,.45),inset 0 0 40px rgba(0,0,0,.55)}',
    '.bj-label{display:flex;align-items:center;gap:8px;font-size:13px;color:#d8b4fe;font-weight:700;text-transform:uppercase;letter-spacing:.5px}',
    '.bj-total{padding:2px 8px;border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:13px;font-weight:800;text-transform:none}',
    '.bj-cards{display:flex;align-items:center;min-height:70px;padding-left:2px}',
    '.bj-card{position:relative;flex:0 0 auto;width:46px;height:66px;margin-left:-24px;border-radius:7px;background:#fff;color:#111;box-shadow:0 2px 6px rgba(0,0,0,.6);font-weight:800;line-height:1}',
    '.bj-card:first-child{margin-left:0}',
    '.bj-card.red{color:#dc2626}',
    '.bj-card .cr{position:absolute;left:4px;top:4px;font-size:14px}',
    '.bj-card .cs{position:absolute;left:4px;top:19px;font-size:12px}',
    '.bj-card .cc{position:absolute;right:5px;bottom:4px;font-size:24px}',
    '.bj-card.back{background:repeating-linear-gradient(45deg,#6d28d9 0 6px,#4c1d95 6px 12px);border:2px solid #fff}',
    '.bj-card.deal{animation:bjDeal .32s ease-out}',
    '.bj-card.flip{animation:bjFlip .35s ease-out}',
    '@keyframes bjDeal{from{transform:translate(70px,-90px) rotate(18deg) scale(.6);opacity:0}to{transform:none;opacity:1}}',
    '@keyframes bjFlip{from{transform:rotateY(90deg)}to{transform:none}}',
    '.bj-msg{min-height:40px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:15px;font-weight:700;color:#fde68a;text-shadow:0 0 8px rgba(251,191,36,.5)}',
    '.bj-side{min-height:18px;text-align:center;font-size:13px;color:#c4b5fd}',
    '.bj-hands{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 8px;-webkit-overflow-scrolling:touch}',
    '.bj-hand{flex:0 0 auto;display:flex;flex-direction:column;gap:4px;min-width:110px;padding:8px;border-radius:14px;border:2px solid transparent;background:rgba(0,0,0,.25)}',
    '.bj-hand.active{border-color:#fbbf24;box-shadow:0 0 14px rgba(251,191,36,.7)}',
    '.bj-hand.win,.bj-hand.bj{border-color:#22c55e}',
    '.bj-hand.lose{border-color:#ef4444;opacity:.85}',
    '.bj-hand.push{border-color:#94a3b8}',
    '.bj-info{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}',
    '.bj-hn{color:#d8b4fe;font-weight:700}',
    '.bj-bet{color:#fbbf24;font-weight:700}',
    '.bj-badge{align-self:flex-start;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:800;background:#334155;color:#fff}',
    '.bj-hand.win .bj-badge{background:#15803d}',
    '.bj-hand.bj .bj-badge{background:linear-gradient(180deg,#fcd34d,#d97706);color:#1a1000}',
    '.bj-hand.lose .bj-badge{background:#b91c1c}',
    '.bj-shoe{display:flex;align-items:center;gap:8px;font-size:11px;color:#a78bfa}',
    '.bj-shoebar{flex:1;height:6px;border-radius:3px;background:#1e1b4b;overflow:hidden}',
    '.bj-shoebar i{display:block;height:100%;background:linear-gradient(90deg,#7c3aed,#fbbf24)}',
    '.bj-hint{min-height:22px;text-align:center;font-size:14px;font-weight:700;color:#fbbf24}',
    '.bj-panel{display:flex;flex-direction:column;gap:8px}',
    '.bj-row{display:flex;gap:8px;flex-wrap:wrap}',
    '.bj-row>.bj-btn{flex:1 1 0;min-width:70px}',
    '.bj-pp{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:14px;background:#1a0f36;border:1px solid #4c1d95}',
    '.bj-pp .bj-btn{min-width:56px;padding:0 8px}',
    '.bj-pp .bj-btn.on{background:linear-gradient(180deg,#a855f7,#6d28d9);box-shadow:0 0 12px rgba(168,85,247,.9)}',
    '.bj-pplabel{font-size:12px;color:#c4b5fd}',
    '.bj-rules h4{margin:12px 0 4px;color:#fbbf24}',
    '.bj-rules ul,.bj-rules ol{margin:4px 0;padding-left:20px}',
    '.bj-rules li{margin:3px 0}',
    '.bj-rules table{width:100%;border-collapse:collapse;font-size:13px}',
    '.bj-rules td,.bj-rules th{padding:4px 6px;border-bottom:1px solid #4c1d95;text-align:left}'
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

  // ---------------------------------------------------------------------
  // Состояние сессии
  // ---------------------------------------------------------------------
  var S = null;

  function wait(ms) {
    var s = S;
    return new Promise(function (resolve) {
      if (!s) return;
      var id = setTimeout(function () {
        var k = s.timers.indexOf(id);
        if (k >= 0) s.timers.splice(k, 1);
        resolve();
      }, ms);
      s.timers.push(id);
    });
  }

  function cur() { return S.hands[S.active]; }

  function placeWager(amount) {
    var id = NB.Wallet.placeBet(GAME_ID, amount); // бросает ошибку при нехватке
    var w = { id: id, amount: amount };
    S.open.push(w);
    return w;
  }

  function settleWager(w, payout, details) {
    var k = S.open.indexOf(w);
    if (k >= 0) S.open.splice(k, 1);
    NB.Wallet.settle(w.id, payout, details);
  }

  // ---------------------------------------------------------------------
  // Разметка
  // ---------------------------------------------------------------------
  function buildDom(container) {
    var root = document.createElement('div');
    root.className = 'nb-bj';
    root.innerHTML =
      '<div class="bj-top">' +
        '<button class="bj-btn" data-a="back" aria-label="Назад">←</button>' +
        '<div class="bj-title">🃏 Блэкджек</div>' +
        '<div class="bj-bal">🪙 <span data-r="bal">0</span></div>' +
      '</div>' +
      '<div class="bj-tools">' +
        '<button class="bj-btn" data-a="rules">📖 Правила</button>' +
        '<label class="bj-switch"><input type="checkbox" data-a="hint"> 💡 Подсказка</label>' +
      '</div>' +
      '<div class="bj-table">' +
        '<div class="bj-label">Дилер <span class="bj-total" data-r="dtotal"></span></div>' +
        '<div class="bj-cards" data-r="dcards"></div>' +
        '<div class="bj-msg" data-r="msg">Сделайте ставку</div>' +
        '<div class="bj-side" data-r="side"></div>' +
        '<div class="bj-label">Вы</div>' +
        '<div class="bj-hands" data-r="hands"></div>' +
        '<div class="bj-shoe"><span data-r="shoetxt"></span><div class="bj-shoebar"><i data-r="shoebar"></i></div></div>' +
      '</div>' +
      '<div class="bj-hint" data-r="hint"></div>' +
      '<div class="bj-panel" data-p="bet">' +
        '<div data-r="betbox"></div>' +
        '<div class="bj-pp">' +
          '<div class="bj-pplabel">Побочная ставка Perfect Pairs (5:1 / 12:1 / 25:1)</div>' +
          '<div class="bj-row" data-r="pprow"></div>' +
        '</div>' +
        '<button class="bj-btn bj-gold" data-a="deal" style="min-height:56px;font-size:17px">Раздать</button>' +
      '</div>' +
      '<div class="bj-panel" data-p="ins">' +
        '<div class="bj-row">' +
          '<button class="bj-btn bj-gold" data-a="ins-yes">Страховка</button>' +
          '<button class="bj-btn" data-a="ins-no">Без страховки</button>' +
        '</div>' +
      '</div>' +
      '<div class="bj-panel" data-p="act">' +
        '<div class="bj-row">' +
          '<button class="bj-btn" data-a="hit">Ещё<br><small>Hit</small></button>' +
          '<button class="bj-btn" data-a="stand">Хватит<br><small>Stand</small></button>' +
        '</div>' +
        '<div class="bj-row">' +
          '<button class="bj-btn" data-a="double">Удвоить</button>' +
          '<button class="bj-btn" data-a="split">Сплит</button>' +
        '</div>' +
      '</div>';
    container.appendChild(root);

    var q = function (sel) { return root.querySelector(sel); };
    S.root = root;
    S.el = {
      bal: q('[data-r="bal"]'), dtotal: q('[data-r="dtotal"]'), dcards: q('[data-r="dcards"]'),
      msg: q('[data-r="msg"]'), side: q('[data-r="side"]'), hands: q('[data-r="hands"]'),
      shoetxt: q('[data-r="shoetxt"]'), shoebar: q('[data-r="shoebar"]'), hint: q('[data-r="hint"]'),
      betbox: q('[data-r="betbox"]'), pprow: q('[data-r="pprow"]'),
      hintChk: q('input[data-a="hint"]'),
      deal: q('[data-a="deal"]'), insYes: q('[data-a="ins-yes"]'),
      hit: q('[data-a="hit"]'), stand: q('[data-a="stand"]'),
      dbl: q('[data-a="double"]'), split: q('[data-a="split"]'),
      panels: { bet: q('[data-p="bet"]'), ins: q('[data-p="ins"]'), act: q('[data-p="act"]') }
    };
  }

  function addListener(el, type, fn) {
    el.addEventListener(type, fn);
    S.listeners.push({ el: el, type: type, fn: fn });
  }

  // ---------------------------------------------------------------------
  // Рендер
  // ---------------------------------------------------------------------
  function cardEl(c, hidden) {
    var d = document.createElement('div');
    var cls = 'bj-card';
    if (hidden) cls += ' back';
    else {
      if (c.red) cls += ' red';
      if (c.flip) cls += ' flip';
    }
    if (c.fresh) cls += ' deal';
    d.className = cls;
    if (!hidden) {
      d.innerHTML = '<span class="cr">' + c.r + '</span><span class="cs">' + c.s + '</span><span class="cc">' + c.s + '</span>';
    }
    c.fresh = false;
    c.flip = false;
    return d;
  }

  function renderDealer() {
    var box = S.el.dcards;
    box.innerHTML = '';
    for (var i = 0; i < S.dealer.length; i++) {
      box.appendChild(cardEl(S.dealer[i], i === 1 && S.holeHidden));
    }
    var tx = '';
    if (S.dealer.length) {
      if (S.holeHidden) tx = String(S.dealer[0].v);
      else {
        var ev = evalHand(S.dealer);
        if (dealerBlackjack(S.dealer)) tx = 'Блэкджек';
        else if (ev.total > 21) tx = 'Перебор ' + ev.total;
        else tx = String(ev.total);
      }
    }
    S.el.dtotal.textContent = tx;
    S.el.dtotal.style.display = tx ? '' : 'none';
  }

  function totalText(h) {
    if (!h.cards.length) return '';
    var ev = evalHand(h.cards);
    if (isBlackjack(h)) return 'Блэкджек!';
    if (ev.total > 21) return 'Перебор ' + ev.total;
    if (ev.soft && ev.total < 21) return 'мягкие ' + ev.total;
    return String(ev.total);
  }

  function renderHands() {
    var box = S.el.hands;
    box.innerHTML = '';
    var activeEl = null;
    S.hands.forEach(function (h, i) {
      var b = document.createElement('div');
      var cls = 'bj-hand';
      var isActive = S.phase === 'player' && i === S.active;
      if (isActive) cls += ' active';
      if (h.outcome) cls += ' ' + h.outcome;
      b.className = cls;
      var cw = document.createElement('div');
      cw.className = 'bj-cards';
      h.cards.forEach(function (c) { cw.appendChild(cardEl(c, false)); });
      b.appendChild(cw);
      var info = document.createElement('div');
      info.className = 'bj-info';
      info.innerHTML =
        (S.hands.length > 1 ? '<span class="bj-hn">Рука ' + (i + 1) + '</span>' : '') +
        '<span class="bj-total">' + esc(totalText(h)) + '</span>' +
        '<span class="bj-bet">🪙 ' + esc(fmt(h.bet)) + (h.doubled ? ' ×2' : '') + '</span>';
      b.appendChild(info);
      if (h.label) {
        var bd = document.createElement('div');
        bd.className = 'bj-badge';
        bd.textContent = h.label;
        b.appendChild(bd);
      }
      box.appendChild(b);
      if (isActive) activeEl = b;
    });
    if (activeEl && S.hands.length > 1) {
      try { activeEl.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
    }
  }

  function renderShoe() {
    var left = shoe.length;
    S.el.shoetxt.textContent = '🂠 Шуз: ' + left + '/' + shoeTotal;
    S.el.shoebar.style.width = Math.max(0, Math.min(100, left / shoeTotal * 100)) + '%';
  }

  function setMsg(t) { if (S) S.el.msg.textContent = t; }

  function setBalance(animate) {
    var nb = NB.Wallet.getBalance();
    var from = S.shownBal;
    S.shownBal = nb;
    if (animate && NB.UI.animateNumber && from !== nb) {
      try { NB.UI.animateNumber(S.el.bal, from, nb, 500); return; } catch (e) { /* fallthrough */ }
    }
    S.el.bal.textContent = fmt(nb);
  }

  function canHit(h) { return !h.done && !h.splitAce; }
  function canDouble(h) {
    return !h.done && !h.splitAce && h.cards.length === 2 && NB.Wallet.canAfford(h.bet);
  }
  function canSplit(h) {
    return !h.done && h.cards.length === 2 && h.cards[0].v === h.cards[1].v &&
      S.hands.length < 1 + MAX_SPLITS && !h.splitAce && NB.Wallet.canAfford(h.bet);
  }

  function updateDealBtn() {
    if (!S || !S.bc) return;
    var bet = S.bc.getBet();
    var total = bet + S.pp;
    S.el.deal.disabled = S.busy || S.phase !== 'bet' || !NB.Wallet.canAfford(total);
    S.el.deal.textContent = 'Раздать · ' + fmt(total);
  }

  function updateControls() {
    if (!S) return;
    var p = S.phase;
    var show = p === 'bet' ? 'bet' : p === 'insurance' ? 'ins' : p === 'player' ? 'act' : 'none';
    var k;
    for (k in S.el.panels) {
      if (Object.prototype.hasOwnProperty.call(S.el.panels, k)) {
        S.el.panels[k].style.display = (k === show) ? '' : 'none';
      }
    }
    var hintTxt = '';
    S.el.hit.classList.remove('rec');
    S.el.stand.classList.remove('rec');
    S.el.dbl.classList.remove('rec');
    S.el.split.classList.remove('rec');

    if (show === 'bet') {
      updateDealBtn();
      renderPP();
    } else if (show === 'ins') {
      var h0 = S.hands[0];
      var cost = Math.floor(h0.bet / 2);
      S.el.insYes.textContent = 'Страховка · ' + fmt(cost);
      S.el.insYes.disabled = S.busy || cost < 1 || !NB.Wallet.canAfford(cost);
      if (S.hint) hintTxt = '💡 Страховка в долгосрочной перспективе невыгодна — лучше отказаться';
    } else if (show === 'act') {
      var h = cur();
      var cd = canDouble(h), cs = canSplit(h);
      S.el.hit.disabled = S.busy || !canHit(h);
      S.el.stand.disabled = S.busy;
      S.el.dbl.disabled = S.busy || !cd;
      S.el.split.disabled = S.busy || !cs;
      S.el.dbl.textContent = 'Удвоить · ' + fmt(h.bet);
      S.el.split.textContent = 'Сплит · ' + fmt(h.bet);
      if (S.hint && !S.busy && S.dealer.length) {
        var rec = recommend(h, S.dealer[0], cd, cs);
        hintTxt = '💡 Базовая стратегия: ' + rec.text;
        var map = { hit: S.el.hit, stand: S.el.stand, double: S.el.dbl, split: S.el.split };
        if (map[rec.a] && !map[rec.a].disabled) map[rec.a].classList.add('rec');
      }
    }
    S.el.hint.textContent = hintTxt;
  }

  function renderPP() {
    var row = S.el.pprow;
    row.innerHTML = '';
    PP_OPTIONS.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'bj-btn' + (S.pp === v ? ' on' : '');
      b.setAttribute('data-pp', String(v));
      b.textContent = v === 0 ? 'Выкл' : String(v);
      row.appendChild(b);
    });
  }

  // ---------------------------------------------------------------------
  // Ход раунда
  // ---------------------------------------------------------------------
  function newHand(bet, wager) {
    return {
      cards: [], bet: bet, wagers: wager ? [wager] : [], doubled: false,
      fromSplit: false, splitAce: false, done: false, outcome: '', label: '', payout: 0
    };
  }

  async function startRound() {
    if (!S || S.busy || S.phase !== 'bet') return;
    var bet = S.bc.getBet();
    var pp = S.pp;
    if (bet < MIN_BET || bet > MAX_BET) {
      toast('Ставка должна быть от ' + MIN_BET + ' до ' + MAX_BET, 'error');
      sfx('error');
      return;
    }
    if (!NB.Wallet.canAfford(bet + pp)) {
      toast(pp > 0 ? 'Не хватает монет на ставку и побочную ставку' : 'Недостаточно монет', 'error');
      sfx('error');
      return;
    }

    S.busy = true;
    S.open = [];
    var mainW, ppW = null;
    try {
      mainW = placeWager(bet);
      if (pp > 0) ppW = placeWager(pp);
    } catch (e) {
      // Откат: возвращаем уже принятую ставку
      if (mainW) { try { settleWager(mainW, mainW.amount, { refund: true, reason: 'bet_failed' }); } catch (e2) { /* ignore */ } }
      S.busy = false;
      toast('Не удалось принять ставку', 'error');
      sfx('error');
      updateControls();
      return;
    }
    S.roundId = mainW.id;
    S.mainWager = mainW;
    S.ins = null;
    S.insPayout = 0;
    S.ppResult = null;
    S.ppPayout = 0;
    S.ppBet = pp;

    sfx('click');
    S.bc.lock(true);
    S.phase = 'deal';
    S.dealer = [];
    S.holeHidden = true;
    var hand = newHand(bet, mainW);
    S.hands = [hand];
    S.active = 0;
    S.el.side.textContent = '';
    setMsg('Раздача...');
    updateControls();
    renderDealer();
    renderHands();

    // Перетасовка при остатке 25%
    if (shoe.length < shoeTotal * RESHUFFLE_AT) {
      buildShoe();
      toast('🔀 Колоды перетасованы', 'info');
      setMsg('Шуз перетасован');
      await wait(500);
    }
    renderShoe();

    // Раздача: игрок, дилер (открытая), игрок, дилер (закрытая)
    hand.cards.push(draw()); sfx('card'); renderHands(); renderShoe(); await wait(380);
    S.dealer.push(draw()); sfx('card'); renderDealer(); renderShoe(); await wait(380);
    hand.cards.push(draw()); sfx('card'); renderHands(); renderShoe(); await wait(380);
    S.dealer.push(draw()); sfx('card'); renderDealer(); renderShoe(); await wait(380);

    // Perfect Pairs рассчитывается сразу
    if (ppW) {
      var res = evalPerfectPairs(hand.cards[0], hand.cards[1]);
      var ppPayout = res ? ppW.amount * (1 + PP_PAYOUT[res]) : 0;
      S.ppResult = res;
      S.ppPayout = ppPayout;
      try {
        settleWager(ppW, ppPayout, {
          game: GAME_ID, type: 'perfect_pairs', parentRound: S.roundId,
          playerCards: hand.cards.map(cardStr), result: res || 'none',
          multiplier: res ? PP_PAYOUT[res] : 0, bet: ppW.amount, payout: ppPayout
        });
      } catch (e) { /* ignore */ }
      if (res) {
        S.el.side.textContent = '✨ Perfect Pairs: ' + PP_NAMES[res] + ' ' + PP_PAYOUT[res] + ':1 (+' + fmt(ppW.amount * PP_PAYOUT[res]) + ')';
        sfx('win');
        toast('Perfect Pairs: ' + PP_NAMES[res] + '!', 'success');
      } else {
        S.el.side.textContent = 'Perfect Pairs: нет пары';
      }
      setBalance(true);
    }

    var up = S.dealer[0];
    if (up.v === 11) {
      S.phase = 'insurance';
      S.busy = false;
      setMsg('Дилер показывает туза. Нужна страховка?');
      renderHands();
      updateControls();
      return;
    }
    await afterInsurance();
  }

  async function takeInsurance(yes) {
    if (!S || S.busy || S.phase !== 'insurance') return;
    S.busy = true;
    if (yes) {
      var cost = Math.floor(S.hands[0].bet / 2);
      try {
        S.ins = placeWager(cost);
        sfx('coin');
      } catch (e) {
        toast('Недостаточно монет для страховки', 'error');
        sfx('error');
        S.busy = false;
        updateControls();
        return;
      }
    } else {
      sfx('click');
    }
    S.phase = 'deal';
    updateControls();
    await afterInsurance();
  }

  async function afterInsurance() {
    var up = S.dealer[0];
    var hand = S.hands[0];
    S.busy = true;
    updateControls();

    if (up.v >= 10) {
      setMsg('Дилер проверяет закрытую карту...');
      await wait(800);
      var dBJ = dealerBlackjack(S.dealer);
      if (S.ins) {
        var insPay = dBJ ? S.ins.amount * 3 : 0;
        S.insPayout = insPay;
        try {
          settleWager(S.ins, insPay, {
            game: GAME_ID, type: 'insurance', parentRound: S.roundId,
            dealerBlackjack: dBJ, bet: S.ins.amount, payout: insPay
          });
        } catch (e) { /* ignore */ }
        if (dBJ) { toast('Страховка сыграла 2:1', 'success'); sfx('coin'); }
        else { toast('Страховка проиграла', 'info'); }
        setBalance(true);
      }
      if (dBJ) {
        setMsg('У дилера блэкджек!');
        await dealerPhase();
        return;
      }
    }

    if (isBlackjack(hand)) {
      setMsg('У вас блэкджек!');
      await wait(400);
      await dealerPhase();
      return;
    }

    S.phase = 'player';
    S.active = 0;
    S.busy = false;
    setMsg('Ваш ход');
    renderHands();
    updateControls();
  }

  // Переход к следующей незавершённой руке или к ходу дилера
  async function advance() {
    var i = S.active + 1;
    while (i < S.hands.length && S.hands[i].done) i++;
    if (i < S.hands.length) {
      S.active = i;
      S.busy = false;
      setMsg(S.hands.length > 1 ? 'Рука ' + (i + 1) + ': ваш ход' : 'Ваш ход');
      renderHands();
      updateControls();
      return;
    }
    await dealerPhase();
  }

  async function doHit() {
    if (!S || S.busy || S.phase !== 'player') return;
    var h = cur();
    if (!canHit(h)) return;
    S.busy = true;
    updateControls();
    sfx('card');
    h.cards.push(draw());
    renderHands(); renderShoe();
    await wait(450);
    var t = evalHand(h.cards).total;
    if (t > 21) {
      sfx('lose');
      setMsg('Перебор!');
      h.done = true;
      await wait(450);
      await advance();
    } else if (t === 21) {
      h.done = true;
      await advance();
    } else {
      S.busy = false;
      renderHands();
      updateControls();
    }
  }

  async function doStand() {
    if (!S || S.busy || S.phase !== 'player') return;
    sfx('click');
    S.busy = true;
    cur().done = true;
    updateControls();
    await advance();
  }

  async function doDouble() {
    if (!S || S.busy || S.phase !== 'player') return;
    var h = cur();
    if (!canDouble(h)) return;
    var w;
    try { w = placeWager(h.bet); } catch (e) {
      toast('Недостаточно монет для удвоения', 'error'); sfx('error'); return;
    }
    S.busy = true;
    h.wagers.push(w);
    h.bet += w.amount;
    h.doubled = true;
    sfx('coin');
    setBalance(true);
    updateControls();
    await wait(250);
    sfx('card');
    h.cards.push(draw());
    renderHands(); renderShoe();
    await wait(650);
    h.done = true;
    if (evalHand(h.cards).total > 21) { sfx('lose'); setMsg('Перебор!'); await wait(350); }
    await advance();
  }

  async function doSplit() {
    if (!S || S.busy || S.phase !== 'player') return;
    var h = cur();
    if (!canSplit(h)) return;
    var w;
    try { w = placeWager(h.bet); } catch (e) {
      toast('Недостаточно монет для сплита', 'error'); sfx('error'); return;
    }
    S.busy = true;
    sfx('coin');
    setBalance(true);
    var nh = newHand(w.amount, w);
    var isAces = h.cards[0].r === 'A';
    nh.cards.push(h.cards.pop());
    h.fromSplit = true;
    nh.fromSplit = true;
    S.hands.splice(S.active + 1, 0, nh);
    renderHands();
    updateControls();
    await wait(350);

    sfx('card'); h.cards.push(draw()); renderHands(); renderShoe(); await wait(380);
    sfx('card'); nh.cards.push(draw()); renderHands(); renderShoe(); await wait(380);

    [h, nh].forEach(function (x) {
      if (isAces) { x.splitAce = true; x.done = true; }
      else if (evalHand(x.cards).total >= 21) { x.done = true; }
    });

    if (h.done) {
      await advance();
    } else {
      S.busy = false;
      setMsg('Рука ' + (S.active + 1) + ': ваш ход');
      renderHands();
      updateControls();
    }
  }

  async function dealerPhase() {
    S.phase = 'dealer';
    S.busy = true;
    updateControls();
    renderHands();
    await wait(300);
    // Открываем закрытую карту
    S.holeHidden = false;
    S.dealer[1].flip = true;
    sfx('card');
    renderDealer();
    await wait(700);

    var anyLive = S.hands.some(function (h) {
      return evalHand(h.cards).total <= 21 && !isBlackjack(h);
    });
    if (anyLive) {
      // Дилер стоит на всех 17 (включая мягкие)
      while (evalHand(S.dealer).total < 17) {
        sfx('card');
        S.dealer.push(draw());
        renderDealer(); renderShoe();
        await wait(700);
      }
    }
    await finishRound();
  }

  async function finishRound() {
    var dEv = evalHand(S.dealer);
    var dBJ = dealerBlackjack(S.dealer);
    var dBust = dEv.total > 21;
    var totalStake = 0, totalPayout = 0;
    var bigBJ = false;

    S.hands.forEach(function (h) {
      var ev = evalHand(h.cards);
      var pt = ev.total;
      var payout = 0, outcome, label;
      if (pt > 21) {
        outcome = 'lose'; label = 'Перебор';
      } else if (isBlackjack(h)) {
        if (dBJ) { outcome = 'push'; label = 'Ничья'; payout = h.bet; }
        else {
          outcome = 'bj'; payout = h.bet + Math.floor(h.bet * 1.5);
          label = 'Блэкджек +' + fmt(payout - h.bet); bigBJ = true;
        }
      } else if (dBJ) {
        outcome = 'lose'; label = 'Проигрыш';
      } else if (dBust || pt > dEv.total) {
        outcome = 'win'; payout = h.bet * 2; label = 'Выигрыш +' + fmt(h.bet);
      } else if (pt === dEv.total) {
        outcome = 'push'; payout = h.bet; label = 'Ничья';
      } else {
        outcome = 'lose'; label = 'Проигрыш';
      }
      h.outcome = outcome; h.label = label; h.payout = payout;
      totalStake += h.bet;
      totalPayout += payout;
    });

    var insBet = S.ins ? S.ins.amount : 0;
    var grandStake = totalStake + insBet + S.ppBet;
    var grandPayout = totalPayout + S.insPayout + S.ppPayout;
    var net = grandPayout - grandStake;

    var details = {
      game: GAME_ID,
      dealer: {
        cards: S.dealer.map(cardStr), total: dEv.total, blackjack: dBJ, bust: dBust
      },
      hands: S.hands.map(function (h) {
        var ev = evalHand(h.cards);
        return {
          cards: h.cards.map(cardStr), total: ev.total, soft: ev.soft, bet: h.bet,
          doubled: h.doubled, fromSplit: h.fromSplit, splitAces: h.splitAce,
          blackjack: isBlackjack(h), bust: ev.total > 21, outcome: h.outcome, payout: h.payout
        };
      }),
      splits: S.hands.length - 1,
      insurance: insBet ? { bet: insBet, payout: S.insPayout, dealerBlackjack: dBJ } : null,
      perfectPairs: S.ppBet ? {
        bet: S.ppBet, result: S.ppResult || 'none',
        multiplier: S.ppResult ? PP_PAYOUT[S.ppResult] : 0, payout: S.ppPayout
      } : null,
      shoeRemaining: shoe.length,
      totalStake: grandStake, totalPayout: grandPayout, net: net, ts: Date.now()
    };

    // Распределяем выплату руки по её ставкам (основная, удвоение, сплит)
    var ops = [];
    S.hands.forEach(function (h) {
      var rest = h.payout;
      var shares = h.wagers.map(function (w) {
        var sh = Math.floor(h.payout * w.amount / h.bet);
        rest -= sh;
        return sh;
      });
      shares[0] += rest;
      h.wagers.forEach(function (w, idx) {
        ops.push({ w: w, payout: shares[idx], hand: h });
      });
    });

    // Основную ставку закрываем последней — с полными деталями раунда
    var mainOp = null;
    ops.forEach(function (o) {
      if (o.w === S.mainWager) { mainOp = o; return; }
      try {
        settleWager(o.w, o.payout, {
          game: GAME_ID, type: 'blackjack_extra_stake', parentRound: S.roundId,
          outcome: o.hand.outcome, bet: o.w.amount, payout: o.payout
        });
      } catch (e) { /* ignore */ }
    });
    if (mainOp) {
      var d = {};
      var k;
      for (k in details) { if (Object.prototype.hasOwnProperty.call(details, k)) d[k] = details[k]; }
      d.type = 'blackjack_main';
      d.bet = mainOp.w.amount;
      d.payout = mainOp.payout;
      try { settleWager(mainOp.w, mainOp.payout, d); } catch (e) { /* ignore */ }
    }

    // Итог в интерфейсе
    S.phase = 'bet';
    S.busy = false;
    S.holeHidden = false;
    renderDealer();
    renderHands();
    setBalance(true);

    var msg;
    if (net > 0) {
      msg = '🎉 Выигрыш: +' + fmt(net);
      sfx(bigBJ || net >= grandStake * 1.5 ? 'bigwin' : 'win');
    } else if (net < 0) {
      msg = 'Проигрыш: ' + fmt(net);
      sfx('lose');
    } else {
      msg = 'Ничья — ставка возвращена';
      sfx('coin');
    }
    if (dBJ) msg = 'Блэкджек дилера. ' + msg;
    else if (dBust) msg = 'Перебор у дилера. ' + msg;
    setMsg(msg);

    S.bc.lock(false);
    updateControls();
  }

  // ---------------------------------------------------------------------
  // Правила (модальное окно из NB.Rules)
  // ---------------------------------------------------------------------
  function rulesHtml(r) {
    var out = '<div class="bj-rules">';
    if (r.goal) out += '<h4>Цель</h4><p>' + esc(r.goal) + '</p>';
    var list = function (title, arr, ordered) {
      if (!arr || !arr.length) return '';
      var tag = ordered ? 'ol' : 'ul';
      return '<h4>' + title + '</h4><' + tag + '>' +
        arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</' + tag + '>';
    };
    out += list('Порядок игры', r.howToPlay, true);
    if (r.payouts && r.payouts.length) {
      out += '<h4>Выплаты</h4><table>';
      r.payouts.forEach(function (p) {
        if (typeof p === 'string') out += '<tr><td colspan="2">' + esc(p) + '</td></tr>';
        else out += '<tr><td>' + esc(p.combo || p.name || '') + '</td><td><b>' + esc(p.payout || p.pays || '') + '</b></td><td>' + esc(p.note || '') + '</td></tr>';
      });
      out += '</table>';
    }
    out += list('Советы', r.tips, false);
    if (r.faq && r.faq.length) {
      out += '<h4>FAQ</h4>';
      r.faq.forEach(function (f) {
        out += '<p><b>' + esc(f.q) + '</b><br>' + esc(f.a) + '</p>';
      });
    }
    return out + '</div>';
  }

  function openRules() {
    var r = NB.Rules && NB.Rules.get ? NB.Rules.get(GAME_ID) : null;
    if (!r) { toast('Правила недоступны', 'error'); return; }
    try {
      NB.UI.modal({
        title: 'Правила: Блэкджек',
        html: rulesHtml(r),
        buttons: [{ text: 'Понятно', label: 'Понятно', primary: true }]
      });
    } catch (e) { toast('Не удалось открыть правила', 'error'); }
  }

  // ---------------------------------------------------------------------
  // mount / unmount
  // ---------------------------------------------------------------------
  function roundInProgress() {
    return !!S && S.open && S.open.length > 0;
  }

  function onClick(ev) {
    if (!S) return;
    var t = ev.target;
    while (t && t !== S.root && !(t.getAttribute && (t.getAttribute('data-a') || t.getAttribute('data-pp') !== null))) {
      t = t.parentNode;
    }
    if (!t || t === S.root) return;

    var pp = t.getAttribute('data-pp');
    if (pp !== null) {
      if (S.phase !== 'bet' || S.busy) return;
      S.pp = parseInt(pp, 10) || 0;
      try { NB.Storage.set(STORE_PP, S.pp); } catch (e) { /* ignore */ }
      sfx('click');
      renderPP();
      updateDealBtn();
      return;
    }
    var a = t.getAttribute('data-a');
    if (t.disabled) return;
    switch (a) {
      case 'deal': startRound(); break;
      case 'hit': doHit(); break;
      case 'stand': doStand(); break;
      case 'double': doDouble(); break;
      case 'split': doSplit(); break;
      case 'ins-yes': takeInsurance(true); break;
      case 'ins-no': takeInsurance(false); break;
      case 'rules': sfx('click'); openRules(); break;
      case 'back':
        sfx('click');
        if (roundInProgress()) {
          NB.UI.confirm('Раунд не завершён. Выйти? Текущие ставки будут потеряны.').then(function (ok) {
            if (ok && S) NB.Router.back();
          });
        } else {
          NB.Router.back();
        }
        break;
      default: break;
    }
  }

  function onHintChange(ev) {
    if (!S) return;
    S.hint = !!ev.target.checked;
    try { NB.Storage.set(STORE_HINT, S.hint); } catch (e) { /* ignore */ }
    sfx('click');
    updateControls();
  }

  function onBalance() {
    if (S) setBalance(true);
    if (S) updateDealBtn();
  }

  function mount(container) {
    if (S) unmount();
    injectStyle();
    if (!shoe.length) buildShoe();

    var savedPP = 0;
    var savedHint = false;
    try {
      savedPP = Number(NB.Storage.get(STORE_PP, 0)) || 0;
      savedHint = !!NB.Storage.get(STORE_HINT, false);
    } catch (e) { /* ignore */ }
    if (PP_OPTIONS.indexOf(savedPP) < 0) savedPP = 0;

    S = {
      timers: [], listeners: [], open: [], phase: 'bet', busy: false,
      hands: [], dealer: [], active: 0, holeHidden: true,
      pp: savedPP, hint: savedHint, shownBal: NB.Wallet.getBalance(),
      roundId: null, mainWager: null, ins: null, insPayout: 0,
      ppResult: null, ppPayout: 0, ppBet: 0, bc: null
    };

    buildDom(container);
    S.el.hintChk.checked = S.hint;
    S.el.bal.textContent = fmt(S.shownBal);

    S.bc = NB.UI.createBetControl(S.el.betbox, {
      gameId: GAME_ID,
      onChange: function () { updateDealBtn(); }
    });

    addListener(S.root, 'click', onClick);
    addListener(S.el.hintChk, 'change', onHintChange);
    NB.Events.on('balance:change', onBalance);
    S.balHandler = onBalance;

    renderDealer();
    renderHands();
    renderShoe();
    renderPP();
    updateControls();
  }

  function unmount() {
    if (!S) return;
    var s = S;

    // Таймеры и обработчики
    s.timers.forEach(function (id) { clearTimeout(id); });
    s.timers = [];
    s.listeners.forEach(function (l) { l.el.removeEventListener(l.type, l.fn); });
    s.listeners = [];
    try { NB.Events.off('balance:change', s.balHandler); } catch (e) { /* ignore */ }

    // Незавершённый раунд: закрываем ставки как проигранные, чтобы не висели
    var open = s.open.slice();
    s.open = [];
    S = null; // после этого отложенные цепочки async не продолжатся
    open.forEach(function (w) {
      try {
        NB.Wallet.settle(w.id, 0, { game: GAME_ID, aborted: true, reason: 'unmount', bet: w.amount, payout: 0 });
      } catch (e) { /* ignore */ }
    });

    if (s.root && s.root.parentNode) s.root.parentNode.removeChild(s.root);
    removeStyle();
  }

  // ---------------------------------------------------------------------
  // Правила игры
  // ---------------------------------------------------------------------
  if (NB.Rules && NB.Rules.register) {
    NB.Rules.register(GAME_ID, {
      title: 'Блэкджек',
      goal: 'Набрать больше очков, чем у дилера, но не больше 21. Если у вас перебор (больше 21) — вы проигрываете сразу, даже если дилер потом тоже переберёт.',
      howToPlay: [
        'Выберите ставку (от ' + MIN_BET + ' до ' + MAX_BET + ' NB-монет). При желании включите побочную ставку Perfect Pairs.',
        'Нажмите «Раздать». Вы получите две карты, дилер — одну открытую и одну закрытую.',
        'Подсчёт очков: карты 2–10 стоят свой номинал, валет, дама и король — по 10. Туз стоит 11 или 1 — автоматически так, как выгоднее вам.',
        'Если у дилера открыт туз, вам предложат страховку. Если открыт туз или десятка, дилер сразу проверяет, нет ли у него блэкджека.',
        'Если у вас блэкджек (туз + десятка с первых двух карт), вы выигрываете 3:2, если у дилера нет блэкджека.',
        'Ваш ход: «Ещё» (Hit) — взять карту; «Хватит» (Stand) — остановиться; «Удвоить» (Double) — удвоить ставку и взять ровно одну карту; «Сплит» (Split) — разделить пару на две руки.',
        'Сплит доступен для двух карт одинаковой стоимости (например, 8+8 или король+десятка). Разделять можно до 3 раз (максимум 4 руки). Для каждой новой руки делается ставка, равная первоначальной. Удвоение после сплита разрешено.',
        'После разделения тузов на каждый туз выдаётся ровно одна карта, повторный сплит и дальнейшие действия недоступны. 21 после сплита — это обычные 21, а не блэкджек (выплата 1:1).',
        'Когда вы закончили, дилер открывает закрытую карту и добирает карты, пока у него меньше 17. На 17 и выше (включая мягкие 17) дилер обязан остановиться.',
        'Сравнение: у кого ближе к 21 — тот выигрывает. При равенстве — ничья, ставка возвращается.'
      ],
      payouts: [
        { combo: 'Блэкджек (туз + 10/картинка)', payout: '3:2', note: 'ставка 100 → выигрыш 150 (вернётся 250)' },
        { combo: 'Обычный выигрыш', payout: '1:1', note: 'ставка 100 → выигрыш 100 (вернётся 200)' },
        { combo: 'Ничья (push)', payout: 'возврат', note: 'ставка возвращается' },
        { combo: 'Проигрыш / перебор', payout: '0', note: 'ставка сгорает' },
        { combo: 'Страховка (у дилера блэкджек)', payout: '2:1', note: 'стоит половину основной ставки' },
        { combo: 'Perfect Pairs: смешанная пара', payout: '5:1', note: 'одинаковый ранг, разные цвета (♠ + ♥)' },
        { combo: 'Perfect Pairs: цветная пара', payout: '12:1', note: 'одинаковый ранг и цвет, разные масти (♥ + ♦)' },
        { combo: 'Perfect Pairs: идеальная пара', payout: '25:1', note: 'одинаковый ранг и масть (♠ + ♠)' }
      ],
      tips: [
        'Включите переключатель «Подсказка» — игра будет показывать ход по базовой стратегии для этих правил (6 колод, дилер стоит на 17).',
        'Всегда делите тузы и восьмёрки. Никогда не делите десятки и пятёрки.',
        'Удваивайте на 11 почти всегда, на 10 — против слабых карт дилера (2–9), на 9 — против 3–6.',
        'Против слабых карт дилера (4, 5, 6) не рискуйте: останавливайтесь уже на 12–16.',
        'Страховка математически невыгодна — отказывайтесь от неё.',
        'Побочная ставка Perfect Pairs — для азарта: у неё высокое преимущество казино, играйте ею небольшими суммами.',
        'Управляйте банком: ставьте не больше 2–5% от баланса, и серия неудач не вынесет вас из игры.'
      ],
      faq: [
        { q: 'Когда перетасовываются колоды?', a: 'В шузе 6 колод (312 карт). Когда остаётся 25% карт, перед следующей раздачей колоды автоматически тасуются заново.' },
        { q: 'Что такое мягкая рука?', a: 'Рука, где туз считается за 11 и не приводит к перебору, например туз+6 = мягкие 17. Такую руку нельзя перебрать одной картой.' },
        { q: 'Дилер берёт карту на мягких 17?', a: 'Нет. Дилер стоит на всех 17, включая мягкие.' },
        { q: 'Почему нельзя взять карту после разделения тузов?', a: 'Это стандартное правило: на каждый туз после сплита выдаётся только одна карта.' },
        { q: 'Что если у меня и у дилера блэкджек?', a: 'Это ничья: ставка возвращается.' },
        { q: 'Как работает страховка?', a: 'Если у дилера открыт туз, можно поставить дополнительно половину основной ставки. Если у дилера блэкджек, страховка платит 2:1 — это покрывает потерю основной ставки. Если нет — страховка проигрывает.' },
        { q: 'Что будет, если выйти из игры посреди раздачи?', a: 'Незавершённый раунд засчитывается как проигранный, ставки не возвращаются.' },
        { q: 'Это реальные деньги?', a: 'Нет. NB-монеты — виртуальная валюта, вывести или купить их за реальные деньги невозможно.' }
      ]
    });
  }

  // ---------------------------------------------------------------------
  // Регистрация игры
  // ---------------------------------------------------------------------
  if (NB.Games && NB.Games.register) {
    NB.Games.register({
      id: GAME_ID,
      name: 'Блэкджек',
      icon: '🃏',
      category: 'cards',
      minBet: MIN_BET,
      maxBet: MAX_BET,
      rtp: 99.5,
      description: 'Классический блэкджек на 6 колод: 3:2 за блэкджек, сплит, удвоение, страховка и побочная ставка Perfect Pairs.',
      mount: mount,
      unmount: unmount
    });
  } else if (window.console) {
    console.warn('[NB.Blackjack] NB.Games не найден — игра не зарегистрирована');
  }

  NB.Blackjack = { recommend: recommend, evalHand: evalHand };
})();