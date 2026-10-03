/* ============================================================================
 * NaebBet — js/core/ui.js
 * Модуль NB.UI: toast, modal, confirm, formatMoney, animateNumber,
 * createBetControl, confetti.
 * Только чистый JS, без зависимостей. Работает офлайн.
 * ========================================================================== */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};
  var doc = document;

  var NBSP = '\u00A0';              // неразрывный пробел для разрядов
  var STYLE_ID = 'nb-ui-style';
  var BET_CAP = 1e9;                // верхняя "бесконечность" для ставки
  var LAST_BETS_KEY = 'nb_lastbets';// { gameId: lastBet }

  /* ------------------------------------------------------------------------
   * Стили (внедряются один раз). Тёмная тема, неон фиолетовый/золотой.
   * ---------------------------------------------------------------------- */
  var CSS = [
    ':root{--nbu-bg:#0b0714;--nbu-surface:#150f29;--nbu-surface2:#1f1640;',
    '--nbu-border:rgba(168,85,247,.45);--nbu-purple:#a855f7;--nbu-gold:#ffd24a;',
    '--nbu-text:#f3eeff;--nbu-muted:#9d93c4;--nbu-ok:#3ddc97;--nbu-danger:#ff4d6d;',
    '--nbu-warn:#ffb020;--nbu-font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',

    /* --- кнопки --- */
    '.nb-btn{appearance:none;-webkit-appearance:none;border:1px solid var(--nbu-border);',
    'background:var(--nbu-surface2);color:var(--nbu-text);font:700 16px/1 var(--nbu-font);',
    'min-height:48px;min-width:44px;padding:0 18px;border-radius:12px;cursor:pointer;',
    'touch-action:manipulation;-webkit-tap-highlight-color:transparent;',
    'transition:transform .08s,box-shadow .15s,opacity .15s}',
    '.nb-btn:active{transform:scale(.96)}',
    '.nb-btn:disabled{opacity:.4;cursor:default;transform:none}',
    '.nb-btn--primary{background:linear-gradient(180deg,#b86bff,#7c3aed);border-color:#c78bff;',
    'box-shadow:0 0 14px rgba(168,85,247,.55);color:#fff}',
    '.nb-btn--gold{background:linear-gradient(180deg,#ffe27a,#f0a800);color:#2a1b00;',
    'border-color:#ffe9a0;box-shadow:0 0 14px rgba(255,210,74,.5)}',
    '.nb-btn--danger{background:linear-gradient(180deg,#ff6b87,#d61f45);border-color:#ff9bb0;color:#fff}',
    '.nb-btn--ghost{background:transparent}',

    /* --- toast --- */
    '.nb-toasts{position:fixed;left:0;right:0;top:0;z-index:10000;display:flex;flex-direction:column;',
    'align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 0;pointer-events:none}',
    '.nb-toast{--nbu-accent:var(--nbu-purple);--nbu-glow:rgba(168,85,247,.45);pointer-events:auto;',
    'display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;max-width:480px;min-height:44px;',
    'padding:10px 14px;border-radius:14px;background:var(--nbu-surface2);color:var(--nbu-text);',
    'border:1px solid var(--nbu-border);border-left:4px solid var(--nbu-accent);',
    'box-shadow:0 6px 24px rgba(0,0,0,.5),0 0 14px var(--nbu-glow);font:600 15px/1.3 var(--nbu-font);',
    'opacity:0;transform:translateY(-16px) scale(.97);transition:opacity .22s,transform .22s;',
    'cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.nb-toast.nb-show{opacity:1;transform:none}',
    '.nb-toast-icon{flex:0 0 auto;font-size:18px}',
    '.nb-toast-text{flex:1 1 auto;word-break:break-word}',
    '.nb-toast--success{--nbu-accent:var(--nbu-ok);--nbu-glow:rgba(61,220,151,.4)}',
    '.nb-toast--error{--nbu-accent:var(--nbu-danger);--nbu-glow:rgba(255,77,109,.45)}',
    '.nb-toast--warning{--nbu-accent:var(--nbu-warn);--nbu-glow:rgba(255,176,32,.4)}',
    '.nb-toast--win{--nbu-accent:var(--nbu-gold);--nbu-glow:rgba(255,210,74,.55);color:var(--nbu-gold)}',

    /* --- modal --- */
    '.nb-modal-overlay{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9000;display:flex;',
    'align-items:center;justify-content:center;box-sizing:border-box;padding:16px;',
    'padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));',
    'background:rgba(5,2,12,.8);opacity:0;transition:opacity .2s;',
    '-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
    '.nb-modal-overlay.nb-show{opacity:1}',
    '.nb-modal{width:100%;max-width:420px;max-height:100%;display:flex;flex-direction:column;',
    'background:linear-gradient(180deg,var(--nbu-surface2),var(--nbu-surface));',
    'border:1px solid var(--nbu-border);border-radius:18px;',
    'box-shadow:0 0 28px rgba(168,85,247,.35),0 16px 48px rgba(0,0,0,.6);',
    'color:var(--nbu-text);font-family:var(--nbu-font);outline:none;',
    'transform:translateY(18px) scale(.97);transition:transform .22s}',
    '.nb-modal-overlay.nb-show .nb-modal{transform:none}',
    '.nb-modal-head{display:flex;align-items:center;gap:8px;padding:12px 8px 4px 16px}',
    '.nb-modal-title{flex:1;margin:0;font:800 19px/1.25 var(--nbu-font);color:var(--nbu-gold);',
    'text-shadow:0 0 10px rgba(255,210,74,.35)}',
    '.nb-modal-x{flex:0 0 auto;width:44px;height:44px;border:0;border-radius:12px;background:transparent;',
    'color:var(--nbu-muted);font:700 20px/1 var(--nbu-font);cursor:pointer;touch-action:manipulation;',
    '-webkit-tap-highlight-color:transparent}',
    '.nb-modal-body{padding:6px 16px 12px;overflow-y:auto;-webkit-overflow-scrolling:touch;',
    'overscroll-behavior:contain;font:400 15px/1.5 var(--nbu-font);color:var(--nbu-text)}',
    '.nb-modal-body p{margin:0 0 10px}',
    '.nb-modal-body ul,.nb-modal-body ol{margin:0 0 10px;padding-left:20px}',
    '.nb-modal-foot{display:flex;flex-wrap:wrap;gap:10px;padding:8px 16px 16px}',
    '.nb-modal-foot .nb-btn{flex:1 1 120px}',

    /* --- контроль ставки --- */
    '.nb-bet{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;padding:12px;',
    'border-radius:16px;background:rgba(21,15,41,.85);border:1px solid var(--nbu-border);',
    'box-shadow:0 0 16px rgba(168,85,247,.2);font-family:var(--nbu-font);color:var(--nbu-text);',
    'transition:opacity .2s}',
    '.nb-bet.nb-locked{opacity:.55;pointer-events:none}',
    '.nb-bet-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
    '.nb-bet-title{font:800 13px/1 var(--nbu-font);text-transform:uppercase;letter-spacing:.1em;color:var(--nbu-purple)}',
    '.nb-bet-limits{font:600 12px/1 var(--nbu-font);color:var(--nbu-muted)}',
    '.nb-bet-input{width:100%;box-sizing:border-box;height:56px;padding:0 12px;border-radius:14px;',
    'border:2px solid rgba(255,210,74,.6);background:#0d0820;color:var(--nbu-gold);text-align:center;',
    'font:800 26px/1 var(--nbu-font);outline:none;-webkit-appearance:none;appearance:none;',
    'text-shadow:0 0 10px rgba(255,210,74,.4);transition:border-color .15s,box-shadow .15s}',
    '.nb-bet-input:focus{border-color:var(--nbu-gold);box-shadow:0 0 16px rgba(255,210,74,.45)}',
    '.nb-bet-input.nb-over{color:var(--nbu-danger);border-color:var(--nbu-danger)}',
    '.nb-bet-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.nb-bet-actions .nb-btn{padding:0;min-height:46px}',
    '.nb-bet-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(48px,1fr));gap:8px;justify-items:center}',
    '.nb-chip{--chip:#7c3aed;position:relative;width:100%;max-width:56px;min-width:48px;aspect-ratio:1/1;',
    'border-radius:50%;border:3px dashed rgba(255,255,255,.85);padding:0;cursor:pointer;color:#fff;',
    'background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.3),transparent 45%),var(--chip);',
    'box-shadow:inset 0 0 0 3px var(--chip),0 3px 8px rgba(0,0,0,.55);',
    'font:800 13px/1 var(--nbu-font);text-shadow:0 1px 2px rgba(0,0,0,.6);',
    'touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .1s,box-shadow .15s}',
    '.nb-chip:active{transform:scale(.92)}',
    '.nb-chip.nb-active{transform:translateY(-2px);',
    'box-shadow:inset 0 0 0 3px var(--chip),0 0 0 3px var(--nbu-gold),0 0 16px rgba(255,210,74,.8)}',
    '.nb-chip:disabled{opacity:.35;filter:grayscale(.6);cursor:default}',
    '.nb-bet-hint{display:none;text-align:center;font:600 12px/1.3 var(--nbu-font);color:var(--nbu-danger)}',
    '.nb-bet-hint.nb-on{display:block}',
    '.nb-shake{animation:nbu-shake .32s}',
    '@keyframes nbu-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}',

    /* --- конфетти --- */
    '.nb-confetti{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:11000}',

    '@media (prefers-reduced-motion:reduce){.nb-toast,.nb-modal-overlay,.nb-modal{transition:none}',
    '.nb-shake{animation:none}}'
  ].join('');

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------------
   * Утилиты
   * ---------------------------------------------------------------------- */

  // Создание элемента с классом и текстом (текст — безопасно, через textContent)
  function h(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function escapeHtml(s) {
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return map[c]; });
  }

  // Безопасный вызов звука (NB.Audio может быть ещё не загружен)
  function sound(name) {
    try {
      if (NB.Audio && typeof NB.Audio.play === 'function') NB.Audio.play(name);
    } catch (e) { /* звук не критичен */ }
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  // Безопасные обёртки над NB.Storage с запасным вариантом в памяти
  var memStore = {};
  function sGet(key, def) {
    try {
      if (NB.Storage && typeof NB.Storage.get === 'function') return NB.Storage.get(key, def);
    } catch (e) { /* падаем на память */ }
    return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : def;
  }
  function sSet(key, val) {
    try {
      if (NB.Storage && typeof NB.Storage.set === 'function') { NB.Storage.set(key, val); return; }
    } catch (e) { /* падаем на память */ }
    memStore[key] = val;
  }

  /* ------------------------------------------------------------------------
   * Форматирование денег
   * ---------------------------------------------------------------------- */

  // Убирает хвостовые нули: 1.50 -> 1.5, 2.00 -> 2
  function trimNum(n, d) {
    var s = n.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  // Полное число с пробелами между разрядами: 1234567 -> "1 234 567"
  function formatFull(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = 0;
    var neg = n < 0;
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return (neg ? '\u2212' : '') + s;
  }

  // До 99 999 — полностью; от 100K — "125.5K"; от 1M — "1.25M"; от 1B — "B"
  function formatMoney(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    var sign = n < 0 ? '\u2212' : '';
    var a = Math.round(Math.abs(n));
    if (a < 1e5) return formatFull(n);
    if (a < 1e6) {
      var k = trimNum(a / 1e3, 1);
      if (parseFloat(k) < 1000) return sign + k + 'K';
    }
    if (a < 1e9) {
      var m = trimNum(a / 1e6, 2);
      if (parseFloat(m) < 1000) return sign + m + 'M';
    }
    return sign + trimNum(a / 1e9, 2) + 'B';
  }
  formatMoney.full = formatFull; // полный вид без суффиксов

  /* ------------------------------------------------------------------------
   * Toast с очередью
   * ---------------------------------------------------------------------- */
  var TOAST_MAX = 3;
  var TOAST_ICONS = { info: '\u2139\uFE0F', success: '\u2705', error: '\u26D4', warning: '\u26A0\uFE0F', win: '\uD83D\uDCB0' };
  var toastQueue = [];
  var toastActive = [];
  var toastBox = null;

  function getToastBox() {
    if (toastBox && toastBox.parentNode) return toastBox;
    toastBox = h('div', 'nb-toasts');
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    doc.body.appendChild(toastBox);
    return toastBox;
  }

  function toastIsDuplicate(text, type) {
    var i;
    for (i = 0; i < toastActive.length; i++) {
      if (!toastActive[i].closed && toastActive[i].text === text && toastActive[i].type === type) return true;
    }
    for (i = 0; i < toastQueue.length; i++) {
      if (toastQueue[i].text === text && toastQueue[i].type === type) return true;
    }
    return false;
  }

  function pumpToasts() {
    while (toastActive.length < TOAST_MAX && toastQueue.length) {
      showToast(toastQueue.shift());
    }
  }

  function showToast(item) {
    var box = getToastBox();
    var el = h('div', 'nb-toast nb-toast--' + item.type);
    el.appendChild(h('span', 'nb-toast-icon', TOAST_ICONS[item.type]));
    el.appendChild(h('span', 'nb-toast-text', item.text));

    var rec = { el: el, text: item.text, type: item.type, closed: false, timer: 0 };

    function close() {
      if (rec.closed) return;
      rec.closed = true;
      clearTimeout(rec.timer);
      el.classList.remove('nb-show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        var idx = toastActive.indexOf(rec);
        if (idx >= 0) toastActive.splice(idx, 1);
        pumpToasts();
      }, 240);
    }

    el.addEventListener('click', close);
    box.appendChild(el);
    toastActive.push(rec);

    void el.offsetWidth; // принудительный reflow для запуска transition
    el.classList.add('nb-show');

    var dur = Math.min(5500, Math.max(2200, 2200 + item.text.length * 35));
    if (item.type === 'error') dur += 800;
    rec.timer = setTimeout(close, dur);
  }

  function toast(text, type) {
    ensureStyle();
    type = TOAST_ICONS[type] ? type : 'info';
    text = String(text === null || text === undefined ? '' : text);
    if (!text) return;
    if (!doc.body) { // скрипт вызван до готовности DOM
      doc.addEventListener('DOMContentLoaded', function () { toast(text, type); });
      return;
    }
    if (toastIsDuplicate(text, type)) return;
    toastQueue.push({ text: text, type: type });
    pumpToasts();
  }

  /* ------------------------------------------------------------------------
   * Modal
   * ---------------------------------------------------------------------- */
  var modalStack = [];
  var scrollLocks = 0;
  var prevOverflow = '';
  var modalSeq = 0;

  function lockScroll() {
    if (scrollLocks === 0) {
      prevOverflow = doc.body.style.overflow;
      doc.body.style.overflow = 'hidden';
    }
    scrollLocks++;
  }
  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) doc.body.style.overflow = prevOverflow;
  }

  /**
   * modal({ title, html, buttons, dismissible, onClose })
   * html — строка HTML или DOM-элемент.
   * buttons — [{ text, type: 'primary'|'gold'|'danger'|'ghost'|'secondary',
   *              value, close (по умолчанию true), onClick(api, ev) }]
   * onClick может вернуть false, чтобы не закрывать окно.
   * Возвращает { el, box, body, close(result), isOpen() }.
   */
  function modal(opts) {
    opts = opts || {};
    ensureStyle();

    var dismissible = opts.dismissible !== false;
    var closed = false;
    var prevFocus = doc.activeElement;

    var overlay = h('div', 'nb-modal-overlay');
    overlay.style.zIndex = String(9000 + modalStack.length * 10);

    var box = h('div', 'nb-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;

    // Заголовок + крестик
    if ((opts.title !== undefined && opts.title !== null && opts.title !== '') || dismissible) {
      var head = h('div', 'nb-modal-head');
      var titleEl = h('h2', 'nb-modal-title', opts.title ? String(opts.title) : '');
      titleEl.id = 'nb-modal-title-' + (++modalSeq);
      if (opts.title) box.setAttribute('aria-labelledby', titleEl.id);
      head.appendChild(titleEl);
      if (dismissible) {
        var x = h('button', 'nb-modal-x', '\u2715');
        x.type = 'button';
        x.setAttribute('aria-label', 'Закрыть');
        x.addEventListener('click', function () { sound('click'); close(null); });
        head.appendChild(x);
      }
      box.appendChild(head);
    }

    // Тело
    var body = h('div', 'nb-modal-body');
    if (opts.html instanceof Node) body.appendChild(opts.html);
    else if (opts.html !== undefined && opts.html !== null) body.innerHTML = String(opts.html);
    box.appendChild(body);

    // Кнопки (по умолчанию одна "OK"; пустой массив — без кнопок)
    var buttons = opts.buttons === undefined ? [{ text: 'OK', type: 'primary' }] : opts.buttons;
    var api = {
      el: overlay,
      box: box,
      body: body,
      close: function (r) { close(r); },
      isOpen: function () { return !closed; }
    };

    if (buttons && buttons.length) {
      var foot = h('div', 'nb-modal-foot');
      buttons.forEach(function (b) {
        var variant = b.type || b.style || 'secondary';
        var btn = h('button', 'nb-btn nb-btn--' + variant, b.text !== undefined ? String(b.text) : (b.label || 'OK'));
        btn.type = 'button';
        btn.addEventListener('click', function (ev) {
          sound('click');
          var keepOpen = false;
          if (typeof b.onClick === 'function') {
            try { keepOpen = b.onClick(api, ev) === false; }
            catch (err) { console.error('NB.UI.modal onClick:', err); }
          }
          if (b.close !== false && !keepOpen) close(b.value !== undefined ? b.value : btn.textContent);
        });
        foot.appendChild(btn);
      });
      box.appendChild(foot);
    }

    overlay.appendChild(box);

    // Закрытие по фону (только если нажатие началось именно на фоне)
    var downOnBackdrop = false;
    function onDown(e) { downOnBackdrop = (e.target === overlay); }
    overlay.addEventListener('pointerdown', onDown);
    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('touchstart', onDown, { passive: true });
    overlay.addEventListener('click', function (e) {
      if (dismissible && e.target === overlay && downOnBackdrop) close(null);
      downOnBackdrop = false;
    });

    // Закрытие по Escape (только верхнее окно)
    function onKey(e) {
      if (e.key === 'Escape' && dismissible && modalStack[modalStack.length - 1] === api) {
        e.preventDefault();
        close(null);
      }
    }
    doc.addEventListener('keydown', onKey, true);

    function close(result) {
      if (closed) return;
      closed = true;
      var idx = modalStack.indexOf(api);
      if (idx >= 0) modalStack.splice(idx, 1);
      doc.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('nb-show');
      unlockScroll();
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 230);
      try {
        if (prevFocus && typeof prevFocus.focus === 'function' && doc.contains(prevFocus)) {
          prevFocus.focus({ preventScroll: true });
        }
      } catch (e) { /* фокус не критичен */ }
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(result); } catch (err) { console.error('NB.UI.modal onClose:', err); }
      }
    }

    doc.body.appendChild(overlay);
    modalStack.push(api);
    lockScroll();
    void overlay.offsetWidth;
    overlay.classList.add('nb-show');
    try { box.focus({ preventScroll: true }); } catch (e) { /* ok */ }

    return api;
  }

  function closeAllModals() {
    modalStack.slice().forEach(function (m) { m.close(null); });
  }

  /**
   * confirm(text[, {title, okText, cancelText, danger}]) -> Promise<boolean>
   * Закрытие по фону / Escape / крестику = false.
   */
  function confirmDialog(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var p = h('p', null, String(text === null || text === undefined ? '' : text));
      p.style.margin = '0';
      p.style.whiteSpace = 'pre-line';
      modal({
        title: opts.title || 'Подтверждение',
        html: p,
        buttons: [
          { text: opts.cancelText || 'Отмена', type: 'secondary', value: false },
          { text: opts.okText || 'Да', type: opts.danger ? 'danger' : 'primary', value: true }
        ],
        onClose: function (r) { resolve(r === true); }
      });
    });
  }

  /* ------------------------------------------------------------------------
   * animateNumber(el, from, to, ms) — плавная смена числа через rAF
   * Возвращает функцию отмены.
   * ---------------------------------------------------------------------- */
  var running = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function animateNumber(el, from, to, ms) {
    if (!el) return function () {};
    if (running) {
      var prev = running.get(el);
      if (prev) prev();
    }

    from = Number(from); if (!isFinite(from)) from = 0;
    to = Number(to); if (!isFinite(to)) to = 0;
    ms = (ms === undefined || ms === null) ? 600 : Math.max(0, Number(ms) || 0);

    if (ms === 0 || from === to || reducedMotion()) {
      el.textContent = formatMoney(to);
      return function () {};
    }

    var raf = 0;
    var start = 0;
    var cancelled = false;

    function cancel() {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (running && running.get(el) === cancel) running.delete(el);
    }

    function frame(ts) {
      if (cancelled) return;
      if (el.isConnected === false) { cancel(); return; } // элемент удалён — прекращаем
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / ms);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = formatMoney(Math.round(from + (to - from) * eased));
      if (p < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        el.textContent = formatMoney(to);
        cancel();
      }
    }

    if (running) running.set(el, cancel);
    el.textContent = formatMoney(from);
    raf = requestAnimationFrame(frame);
    return cancel;
  }

  /* ------------------------------------------------------------------------
   * createBetControl(container, { gameId, onChange }) -> { getBet, setBet, lock }
   * Дополнительно: destroy(), refresh(), isLocked().
   * onChange(bet, source) — source: 'chip'|'half'|'x2'|'max'|'input'|'api'|'balance'
   * ---------------------------------------------------------------------- */
  var CHIP_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#0f766e', '#d97706'];
  var CHIP_MULT = [1, 5, 10, 50, 100, 500];
  var betControls = (typeof WeakMap === 'function') ? new WeakMap() : null;

  function chipLabel(v) {
    if (v >= 1e6) return trimNum(v / 1e6, 1) + 'M';
    if (v >= 1e3) return trimNum(v / 1e3, 1) + 'K';
    return String(v);
  }

  function createBetControl(container, opts) {
    ensureStyle();
    opts = opts || {};
    if (!container) throw new Error('NB.UI.createBetControl: не указан контейнер');

    var gameId = opts.gameId || 'default';
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    // Если на контейнере уже висит контрол — уничтожаем старый
    if (betControls) {
      var old = betControls.get(container);
      if (old) old.destroy();
    }

    var min = 1, max = BET_CAP, bet = 1;
    var locked = false, dirty = false, destroyed = false;
    var timers = [];
    var chips = [];       // [{v, el}]
    var chipSig = '';

    /* --- лимиты и баланс --- */
    function limits() {
      var g = null;
      try {
        g = (NB.Games && typeof NB.Games.get === 'function') ? NB.Games.get(gameId) : null;
      } catch (e) { g = null; }
      var mn = Number(opts.minBet) > 0 ? Number(opts.minBet) : (g && Number(g.minBet) > 0 ? Number(g.minBet) : 1);
      var mx = Number(opts.maxBet) > 0 ? Number(opts.maxBet) : (g && Number(g.maxBet) > 0 ? Number(g.maxBet) : BET_CAP);
      mn = Math.floor(mn);
      mx = Math.floor(mx);
      if (mx < mn) mx = mn;
      min = mn;
      max = mx;
    }

    function balance() {
      try {
        if (NB.Wallet && typeof NB.Wallet.getBalance === 'function') {
          var b = Number(NB.Wallet.getBalance());
          if (isFinite(b)) return b;
        }
      } catch (e) { /* игнор */ }
      return BET_CAP;
    }

    // Максимально допустимая ставка сейчас (лимит игры и баланс)
    function upper() {
      limits();
      var bal = balance();
      return bal >= min ? Math.min(max, Math.floor(bal)) : min;
    }

    function clamp(n) {
      var u = upper();
      n = Math.floor(Number(n));
      if (!isFinite(n)) n = min;
      return Math.max(min, Math.min(n, u));
    }

    /* --- последняя ставка по gameId --- */
    function loadLast() {
      var all = sGet(LAST_BETS_KEY, null);
      if (typeof all === 'string') { try { all = JSON.parse(all); } catch (e) { all = null; } }
      if (all && typeof all === 'object' && typeof all[gameId] === 'number') return all[gameId];
      return null;
    }
    function saveLast() {
      var all = sGet(LAST_BETS_KEY, null);
      if (typeof all === 'string') { try { all = JSON.parse(all); } catch (e) { all = null; } }
      if (!all || typeof all !== 'object') all = {};
      all[gameId] = bet;
      sSet(LAST_BETS_KEY, all);
    }

    /* --- DOM --- */
    var root = h('div', 'nb-bet');

    var head = h('div', 'nb-bet-head');
    var limitsEl = h('span', 'nb-bet-limits');
    head.appendChild(h('span', 'nb-bet-title', 'Ставка'));
    head.appendChild(limitsEl);

    var input = h('input', 'nb-bet-input');
    input.type = 'text';
    input.maxLength = 10;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', 'Размер ставки');

    function mkBtn(label, extra, aria) {
      var b = h('button', 'nb-btn' + (extra ? ' ' + extra : ''), label);
      b.type = 'button';
      if (aria) b.setAttribute('aria-label', aria);
      return b;
    }
    var actions = h('div', 'nb-bet-actions');
    var btnHalf = mkBtn('\u00BD', '', 'Уменьшить ставку вдвое');
    var btnDouble = mkBtn('x2', '', 'Удвоить ставку');
    var btnMax = mkBtn('MAX', 'nb-btn--gold', 'Максимальная ставка');
    actions.appendChild(btnHalf);
    actions.appendChild(btnDouble);
    actions.appendChild(btnMax);

    var chipsEl = h('div', 'nb-bet-chips');
    var hint = h('div', 'nb-bet-hint', 'Недостаточно монет для минимальной ставки');

    root.appendChild(head);
    root.appendChild(input);
    root.appendChild(actions);
    root.appendChild(chipsEl);
    root.appendChild(hint);

    /* --- чипы: min × [1,5,10,50,100,500], не выше max игры --- */
    function buildChips() {
      var sig = min + '|' + max;
      if (sig === chipSig) return;
      chipSig = sig;
      chipsEl.innerHTML = '';
      chips = [];
      var seen = {};
      CHIP_MULT.forEach(function (m, i) {
        var v = min * m;
        if (v > max || seen[v]) return;
        seen[v] = true;
        var el = h('button', 'nb-chip', chipLabel(v));
        el.type = 'button';
        el.style.setProperty('--chip', CHIP_COLORS[i % CHIP_COLORS.length]);
        el.setAttribute('aria-label', 'Ставка ' + formatFull(v));
        el.addEventListener('click', function () {
          leaveInput();
          sound('coin');
          applyBet(v, 'chip', true);
        });
        chipsEl.appendChild(el);
        chips.push({ v: v, el: el });
      });
    }

    /* --- отрисовка --- */
    function render() {
      if (destroyed) return;
      limits();
      buildChips();

      var bal = balance();
      var canPlay = bal >= min;
      var u = upper();

      limitsEl.textContent = max >= BET_CAP ? ('от ' + formatMoney(min)) : (formatMoney(min) + ' \u2013 ' + formatMoney(max));

      if (!dirty && doc.activeElement !== input) input.value = formatFull(bet);
      input.disabled = locked;

      for (var i = 0; i < chips.length; i++) {
        var c = chips[i];
        c.el.classList.toggle('nb-active', c.v === bet);
        c.el.disabled = locked || c.v > bal;
      }
      btnHalf.disabled = locked || !canPlay || bet <= min;
      btnDouble.disabled = locked || !canPlay || bet >= u;
      btnMax.disabled = locked || !canPlay || bet >= u;
      hint.classList.toggle('nb-on', !canPlay);
    }

    function fire(source) {
      if (!onChange) return;
      try { onChange(bet, source); }
      catch (err) { console.error('NB.UI.createBetControl onChange:', err); }
    }

    function applyBet(n, source, persist) {
      var v = clamp(n);
      var changed = v !== bet;
      bet = v;
      if (persist) saveLast();
      render();
      if (changed) fire(source);
      return bet;
    }

    function shake() {
      input.classList.remove('nb-shake');
      void input.offsetWidth;
      input.classList.add('nb-shake');
      timers.push(setTimeout(function () { input.classList.remove('nb-shake'); }, 360));
    }

    /* --- ручной ввод --- */
    function commitInput() {
      if (!dirty) return;
      dirty = false;
      var raw = input.value.replace(/\D/g, '');
      input.classList.remove('nb-over');
      var n = raw === '' ? bet : parseInt(raw, 10);
      var v = clamp(n);
      if (n !== v) {
        if (n < min) toast('Минимальная ставка: ' + formatFull(min), 'warning');
        else if (n > max) toast('Максимальная ставка: ' + formatFull(max), 'warning');
        else toast('Ставка ограничена вашим балансом', 'warning');
        sound('error');
        shake();
      }
      applyBet(v, 'input', true);
    }

    // Уводим фокус с поля (прячет клавиатуру, фиксирует введённое)
    function leaveInput() {
      if (doc.activeElement === input) input.blur();
      else commitInput();
    }

    input.addEventListener('focus', function () {
      if (locked) return;
      dirty = false;
      input.value = String(bet);
      timers.push(setTimeout(function () {
        try { input.select(); } catch (e) { /* ok */ }
      }, 0));
    });
    input.addEventListener('input', function () {
      var digits = input.value.replace(/\D/g, '');
      if (digits !== input.value) input.value = digits;
      dirty = true;
      var n = digits === '' ? NaN : parseInt(digits, 10);
      input.classList.toggle('nb-over', isFinite(n) && (n > upper() || n < min));
    });
    input.addEventListener('blur', function () {
      commitInput();
      render();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });

    /* --- кнопки ½, x2, MAX --- */
    btnHalf.addEventListener('click', function () {
      leaveInput(); sound('click');
      applyBet(Math.floor(bet / 2), 'half', true);
    });
    btnDouble.addEventListener('click', function () {
      leaveInput(); sound('click');
      applyBet(bet * 2, 'x2', true);
    });
    btnMax.addEventListener('click', function () {
      leaveInput(); sound('coin');
      applyBet(upper(), 'max', true);
    });

    /* --- реакция на изменение баланса --- */
    function onBalance() {
      if (destroyed) return;
      if (locked) { render(); return; } // во время раунда ставку не трогаем
      applyBet(bet, 'balance', false);
    }
    if (NB.Events && typeof NB.Events.on === 'function') NB.Events.on('balance:change', onBalance);

    /* --- публичный API --- */
    function getBet() {
      if (dirty) commitInput(); // на мобильных blur может не сработать до тапа по кнопке игры
      return bet;
    }

    function setBet(n) {
      return applyBet(n, 'api', true);
    }

    function lock(flag) {
      flag = !!flag;
      if (flag && dirty) commitInput();
      locked = flag;
      root.classList.toggle('nb-locked', locked);
      if (locked) {
        if (doc.activeElement === input) input.blur();
        render();
      } else {
        applyBet(bet, 'balance', false); // после раунда подгоняем ставку под баланс
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (NB.Events && typeof NB.Events.off === 'function') NB.Events.off('balance:change', onBalance);
      timers.forEach(clearTimeout);
      timers.length = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
      if (betControls && betControls.get(container) === control) betControls.delete(container);
    }

    var control = {
      getBet: getBet,
      setBet: setBet,
      lock: lock,
      destroy: destroy,
      refresh: function () { applyBet(bet, 'balance', false); },
      isLocked: function () { return locked; }
    };

    /* --- инициализация --- */
    limits();
    var stored = loadLast();
    bet = clamp(stored !== null ? stored : min);
    container.appendChild(root);
    render();
    if (betControls) betControls.set(container, control);

    return control;
  }

  /* ------------------------------------------------------------------------
   * Конфетти на canvas: NB.UI.confetti([{count, colors}]) -> stop()
   * Math.random здесь допустим: это чистая косметика, на исход игр не влияет.
   * ---------------------------------------------------------------------- */
  var CF_MAX = 450;
  var CF_COLORS = ['#a855f7', '#c084fc', '#ffd24a', '#ffe27a', '#ff4d8d', '#3dd9ff', '#ffffff'];
  var cf = { canvas: null, ctx: null, parts: [], raf: 0, last: 0, w: 0, h: 0, dpr: 1 };

  function cfRand(a, b) { return a + Math.random() * (b - a); }

  function cfResize() {
    if (!cf.canvas) return;
    cf.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cf.w = window.innerWidth;
    cf.h = window.innerHeight;
    cf.canvas.width = Math.round(cf.w * cf.dpr);
    cf.canvas.height = Math.round(cf.h * cf.dpr);
    cf.ctx.setTransform(cf.dpr, 0, 0, cf.dpr, 0, 0);
  }

  function cfStop() {
    if (cf.raf) cancelAnimationFrame(cf.raf);
    cf.raf = 0;
    cf.last = 0;
    cf.parts.length = 0;
    window.removeEventListener('resize', cfResize);
    window.removeEventListener('orientationchange', cfResize);
    if (cf.canvas && cf.canvas.parentNode) cf.canvas.parentNode.removeChild(cf.canvas);
    cf.canvas = null;
    cf.ctx = null;
  }

  function cfMake(x, y, vx, vy, colors) {
    return {
      x: x, y: y, vx: vx, vy: vy,
      w: cfRand(6, 11), h: cfRand(4, 7),
      rot: cfRand(0, Math.PI * 2), vr: cfRand(-0.3, 0.3),
      wob: cfRand(0, Math.PI * 2), wobS: cfRand(0.08, 0.2),
      color: colors[Math.floor(Math.random() * colors.length)],
      circle: Math.random() < 0.2,
      age: 0, ttl: cfRand(2400, 4200)
    };
  }

  function cfTick(ts) {
    cf.raf = 0;
    if (!cf.ctx) return;
    var dt = cf.last ? Math.min((ts - cf.last) / 16.667, 3) : 1;
    cf.last = ts;
    var ms = dt * 16.667;
    var ctx = cf.ctx;
    var arr = cf.parts;
    var dragX = Math.pow(0.975, dt);
    var dragY = Math.pow(0.97, dt);

    ctx.clearRect(0, 0, cf.w, cf.h);

    for (var i = arr.length - 1; i >= 0; i--) {
      var p = arr[i];
      p.age += ms;
      p.vy += 0.38 * dt;
      p.vx *= dragX;
      p.vy *= dragY;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.wob += p.wobS * dt;

      var life = p.age / p.ttl;
      if (life >= 1 || p.y > cf.h + 30) { arr.splice(i, 1); continue; }

      ctx.save();
      ctx.globalAlpha = life > 0.75 ? 1 - (life - 0.75) / 0.25 : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        var sy = Math.abs(Math.cos(p.wob)); // эффект переворота бумажки
        ctx.fillRect(-p.w / 2, -p.h * sy / 2, p.w, Math.max(0.5, p.h * sy));
      }
      ctx.restore();
    }

    if (arr.length) cf.raf = requestAnimationFrame(cfTick);
    else cfStop();
  }

  function confetti(opts) {
    opts = opts || {};
    if (reducedMotion()) return function () {};
    ensureStyle();
    if (!doc.body) return function () {};

    var count = Math.max(10, Math.min(Number(opts.count) || 150, 300));
    var colors = (opts.colors && opts.colors.length) ? opts.colors : CF_COLORS;

    if (!cf.canvas) {
      cf.canvas = h('canvas', 'nb-confetti');
      cf.canvas.setAttribute('aria-hidden', 'true');
      cf.ctx = cf.canvas.getContext('2d');
      doc.body.appendChild(cf.canvas);
      cfResize();
      window.addEventListener('resize', cfResize);
      window.addEventListener('orientationchange', cfResize);
    }

    var room = CF_MAX - cf.parts.length;
    if (room <= 0) return cfStop;
    count = Math.min(count, room);

    var cannon = Math.round(count * 0.6);
    var rain = count - cannon;
    var scale = Math.max(0.8, Math.min(1.4, cf.h / 700));
    var i;

    // Две "пушки" снизу слева и справа
    for (i = 0; i < cannon; i++) {
      var left = (i % 2 === 0);
      var ang = (left ? cfRand(-80, -50) : cfRand(-130, -100)) * Math.PI / 180;
      var sp = cfRand(11, 22) * scale;
      cf.parts.push(cfMake(
        left ? cf.w * 0.05 : cf.w * 0.95, cf.h * 0.92,
        Math.cos(ang) * sp, Math.sin(ang) * sp, colors
      ));
    }
    // "Дождь" сверху
    for (i = 0; i < rain; i++) {
      cf.parts.push(cfMake(
        cfRand(0, cf.w), cfRand(-cf.h * 0.3, -10),
        cfRand(-1.5, 1.5), cfRand(1.5, 4), colors
      ));
    }

    if (!cf.raf) {
      cf.last = 0;
      cf.raf = requestAnimationFrame(cfTick);
    }
    return cfStop;
  }

  /* ------------------------------------------------------------------------
   * Экспорт модуля
   * ---------------------------------------------------------------------- */
  NB.UI = {
    toast: toast,
    modal: modal,
    confirm: confirmDialog,
    formatMoney: formatMoney,
    animateNumber: animateNumber,
    createBetControl: createBetControl,
    confetti: confetti,
    // Дополнительные помощники
    escapeHtml: escapeHtml,
    closeAllModals: closeAllModals
  };
})();