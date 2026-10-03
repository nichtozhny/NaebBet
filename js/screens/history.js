/* ==========================================================================
   NaebBet — js/screens/history.js
   Экран «История ставок»: бесконечный список с подгрузкой, фильтры по игре
   и результату, поиск по диапазону суммы, карточка раунда, сводка по фильтру.
   ========================================================================== */
(function () {
  'use strict';

  const NB = (window.NB = window.NB || {});

  /* ---------- Константы ---------- */
  const SCREEN_ID = 'history';
  const PAGE_SIZE = 25;          // сколько карточек добавляется за одну подгрузку
  const LOAD_LIMIT = 100000;     // верхняя граница запроса истории из Stats
  const DEBOUNCE_MS = 250;       // задержка применения фильтра суммы
  const STYLE_ID = 'nb-history-style';

  /* Человекочитаемые названия частых ключей details */
  const KEY_LABELS = {
    result: 'Результат', outcome: 'Исход', multiplier: 'Множитель', mult: 'Множитель',
    cards: 'Карты', hand: 'Рука', dealer: 'Дилер', player: 'Игрок', total: 'Сумма',
    number: 'Число', color: 'Цвет', symbols: 'Символы', lines: 'Линии', win: 'Выигрыш',
    bet: 'Ставка', payout: 'Выплата', reason: 'Причина', choice: 'Выбор', bets: 'Ставки',
    dice: 'Кубики', roll: 'Бросок', spins: 'Спины', rounds: 'Раунды', mines: 'Мины',
    picks: 'Выбор', steps: 'Шаги', target: 'Цель', side: 'Сторона', hands: 'Раздачи'
  };

  /* ---------- Состояние экрана ---------- */
  let root = null;               // корневой элемент экрана
  let els = {};                  // ссылки на DOM-узлы
  let all = [];                  // все записи истории (нормализованные)
  let filtered = [];             // записи после применения фильтров
  let shown = 0;                 // сколько записей уже отрисовано
  let lastDayKey = null;         // для разделителей по дням
  let observer = null;           // IntersectionObserver для подгрузки
  let debounceTimer = null;
  let mounted = false;
  let filters = { game: 'all', result: 'all', field: 'bet', min: '', max: '' };

  /* ---------- Утилиты ---------- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(n) {
    n = Math.round(Number(n) || 0);
    try {
      if (NB.UI && typeof NB.UI.formatMoney === 'function') return NB.UI.formatMoney(n);
    } catch (e) { /* падаем на запасной формат */ }
    return n.toLocaleString('ru-RU');
  }

  function fmtSigned(n) {
    n = Math.round(Number(n) || 0);
    if (n > 0) return '+' + fmt(n);
    if (n < 0) return '\u2212' + fmt(-n);
    return fmt(0);
  }

  function sound(name) {
    try { if (NB.Audio) NB.Audio.play(name); } catch (e) { /* звук не критичен */ }
  }

  function gameInfo(id) {
    let g = null;
    try { g = NB.Games && NB.Games.get ? NB.Games.get(id) : null; } catch (e) { g = null; }
    return {
      name: g && g.name ? g.name : String(id || 'Игра'),
      icon: g && g.icon ? g.icon : '🎲'
    };
  }

  function resultOf(rec) {
    if (rec.payout > rec.bet) return 'win';
    if (rec.payout < rec.bet) return 'lose';
    return 'push';
  }

  const RESULT_LABEL = { win: 'Выигрыш', lose: 'Проигрыш', push: 'Возврат' };

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayKey(ts) === dayKey(now.getTime())) return 'Сегодня';
    if (dayKey(ts) === dayKey(y.getTime())) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function timeShort(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function timeFull(ts) {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function parseAmount(s) {
    const clean = String(s || '').replace(/[^\d]/g, '');
    return clean === '' ? null : Number(clean);
  }

  /* ---------- Рендер деталей раунда ---------- */
  function fmtValue(v) {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('ru-RU') : String(Math.round(v * 100) / 100);
    if (Array.isArray(v)) {
      const simple = v.every(x => x == null || typeof x !== 'object');
      if (simple) return v.map(x => fmtValue(x)).join(', ') || '—';
    }
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return '[объект]'; }
    }
    return String(v);
  }

  function renderDetails(d) {
    if (d == null || d === '') return '<div class="hs-empty-d">Деталей нет</div>';
    if (typeof d !== 'object') return '<div class="hs-detail-text">' + esc(d) + '</div>';
    const keys = Object.keys(d);
    if (!keys.length) return '<div class="hs-empty-d">Деталей нет</div>';
    return keys.map(k => (
      '<div class="hs-row"><span>' + esc(KEY_LABELS[k] || k) + '</span>' +
      '<b>' + esc(fmtValue(d[k])) + '</b></div>'
    )).join('');
  }

  function renderBody(rec) {
    const g = gameInfo(rec.gameId);
    const net = rec.payout - rec.bet;
    const mult = rec.bet > 0 ? rec.payout / rec.bet : 0;
    return (
      '<div class="hs-row"><span>Время</span><b>' + esc(timeFull(rec.ts)) + '</b></div>' +
      '<div class="hs-row"><span>Игра</span><b>' + esc(g.icon + ' ' + g.name) + '</b></div>' +
      '<div class="hs-row"><span>Ставка</span><b>' + fmt(rec.bet) + '</b></div>' +
      '<div class="hs-row"><span>Выплата</span><b>' + fmt(rec.payout) + '</b></div>' +
      '<div class="hs-row"><span>Итог</span><b class="hs-' + resultOf(rec) + '-t">' + fmtSigned(net) + '</b></div>' +
      '<div class="hs-row"><span>Множитель</span><b>×' + (Math.round(mult * 100) / 100) + '</b></div>' +
      '<div class="hs-sub">Детали раунда</div>' + renderDetails(rec.details)
    );
  }

  /* ---------- Загрузка и фильтрация данных ---------- */
  function loadHistory() {
    let list = [];
    try {
      list = NB.Stats && NB.Stats.getHistory ? NB.Stats.getHistory({ limit: LOAD_LIMIT }) : [];
    } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    all = list.map(r => ({
      gameId: r.gameId,
      bet: Number(r.bet) || 0,
      payout: Number(r.payout) || 0,
      details: r.details,
      ts: Number(r.ts) || 0
    }));
    all.sort((a, b) => b.ts - a.ts); // новые сверху
  }

  function applyFilters() {
    let lo = parseAmount(filters.min);
    let hi = parseAmount(filters.max);
    if (lo != null && hi != null && lo > hi) { const t = lo; lo = hi; hi = t; }
    const field = filters.field === 'payout' ? 'payout' : 'bet';

    filtered = all.filter(r => {
      if (filters.game !== 'all' && r.gameId !== filters.game) return false;
      if (filters.result !== 'all' && resultOf(r) !== filters.result) return false;
      const v = r[field];
      if (lo != null && v < lo) return false;
      if (hi != null && v > hi) return false;
      return true;
    });
  }

  /* ---------- Сводка ---------- */
  function renderSummary() {
    const n = filtered.length;
    let bet = 0, payout = 0, wins = 0, losses = 0, pushes = 0;
    let best = null, worst = null;
    filtered.forEach(r => {
      bet += r.bet; payout += r.payout;
      const res = resultOf(r);
      if (res === 'win') wins++; else if (res === 'lose') losses++; else pushes++;
      const net = r.payout - r.bet;
      if (best === null || net > best) best = net;
      if (worst === null || net < worst) worst = net;
    });
    const net = payout - bet;
    const rate = n ? Math.round((wins / n) * 1000) / 10 : 0;
    const rtp = bet ? Math.round((payout / bet) * 1000) / 10 : 0;
    const netCls = net > 0 ? 'hs-win-t' : net < 0 ? 'hs-lose-t' : '';

    els.summary.innerHTML =
      '<div class="hs-sum-title">Сводка по фильтру</div>' +
      '<div class="hs-sum-grid">' +
      tile('Раундов', n.toLocaleString('ru-RU'), '') +
      tile('Итог', fmtSigned(net), netCls) +
      tile('Поставлено', fmt(bet), '') +
      tile('Выплачено', fmt(payout), '') +
      tile('Побед', wins + ' (' + rate + '%)', 'hs-win-t') +
      tile('Поражений', String(losses), 'hs-lose-t') +
      tile('Лучший', best === null ? '—' : fmtSigned(best), best > 0 ? 'hs-win-t' : '') +
      tile('Худший', worst === null ? '—' : fmtSigned(worst), worst < 0 ? 'hs-lose-t' : '') +
      '</div>' +
      '<div class="hs-sum-foot">Возвратов: ' + pushes + ' · Возврат к игроку: ' + rtp + '%</div>';
  }

  function tile(label, value, cls) {
    return '<div class="hs-tile"><span>' + esc(label) + '</span><b class="' + cls + '">' + esc(value) + '</b></div>';
  }

  /* ---------- Рендер списка ---------- */
  function resetList() {
    els.list.innerHTML = '';
    shown = 0;
    lastDayKey = null;
    detach();
    renderMore();
  }

  function renderMore() {
    if (!mounted) return;
    if (!filtered.length) {
      els.list.innerHTML = '<div class="hs-empty">' +
        (all.length ? '🔍 По вашему фильтру ничего не найдено' : '🎰 История пока пуста.<br>Сделайте первую ставку!') +
        '</div>';
      els.more.hidden = true;
      return;
    }

    const end = Math.min(shown + PAGE_SIZE, filtered.length);
    const frag = document.createDocumentFragment();

    for (let i = shown; i < end; i++) {
      const rec = filtered[i];
      const key = dayKey(rec.ts);
      if (key !== lastDayKey) {
        const sep = document.createElement('div');
        sep.className = 'hs-day';
        sep.textContent = dayLabel(rec.ts);
        frag.appendChild(sep);
        lastDayKey = key;
      }
      frag.appendChild(buildCard(rec, i));
    }
    els.list.appendChild(frag);
    shown = end;

    const hasMore = shown < filtered.length;
    els.more.hidden = !hasMore;
    if (hasMore) {
      els.moreBtn.textContent = 'Показать ещё (' + (filtered.length - shown) + ')';
      attach();
    } else {
      detach();
    }
  }

  function buildCard(rec, idx) {
    const g = gameInfo(rec.gameId);
    const res = resultOf(rec);
    const net = rec.payout - rec.bet;
    const card = document.createElement('div');
    card.className = 'hs-card hs-' + res;
    card.setAttribute('data-i', String(idx));
    card.innerHTML =
      '<button type="button" class="hs-card-head" aria-expanded="false">' +
        '<span class="hs-ico">' + esc(g.icon) + '</span>' +
        '<span class="hs-main"><b>' + esc(g.name) + '</b>' +
          '<small>' + esc(timeShort(rec.ts)) + ' · ' + RESULT_LABEL[res] + '</small></span>' +
        '<span class="hs-amt"><b class="hs-' + res + '-t">' + fmtSigned(net) + '</b>' +
          '<small>ставка ' + fmt(rec.bet) + '</small></span>' +
      '</button>' +
      '<div class="hs-body" hidden></div>';
    return card;
  }

  /* ---------- Бесконечная прокрутка ---------- */
  function attach() {
    if (!('IntersectionObserver' in window)) return; // остаётся кнопка «Показать ещё»
    if (!observer) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) renderMore();
      }, { rootMargin: '300px 0px' });
    }
    // переподписка, чтобы сработать повторно, если сентинел всё ещё виден
    observer.unobserve(els.more);
    observer.observe(els.more);
  }

  function detach() {
    if (observer) observer.disconnect();
  }

  /* ---------- Обработчики ---------- */
  function onListClick(e) {
    const head = e.target.closest ? e.target.closest('.hs-card-head') : null;
    if (!head) return;
    const card = head.parentNode;
    const body = card.querySelector('.hs-body');
    const open = body.hidden;
    if (open && !body.getAttribute('data-ready')) {
      const rec = filtered[Number(card.getAttribute('data-i'))];
      if (rec) body.innerHTML = renderBody(rec);
      body.setAttribute('data-ready', '1');
    }
    body.hidden = !open;
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    card.classList.toggle('hs-open', open);
    sound('click');
  }

  function refresh() {
    applyFilters();
    renderSummary();
    resetList();
  }

  function onGameChange() {
    filters.game = els.game.value;
    sound('click');
    refresh();
  }

  function onSegClick(e) {
    const btn = e.target.closest ? e.target.closest('[data-seg]') : null;
    if (!btn) return;
    const kind = btn.getAttribute('data-seg');
    const val = btn.getAttribute('data-val');
    filters[kind] = val;
    updateSegs();
    sound('click');
    refresh();
  }

  function updateSegs() {
    const btns = root.querySelectorAll('[data-seg]');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const on = filters[b.getAttribute('data-seg')] === b.getAttribute('data-val');
      b.classList.toggle('hs-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function onAmountInput() {
    filters.min = els.min.value;
    filters.max = els.max.value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, DEBOUNCE_MS);
  }

  function onReset() {
    filters = { game: 'all', result: 'all', field: 'bet', min: '', max: '' };
    els.game.value = 'all';
    els.min.value = '';
    els.max.value = '';
    updateSegs();
    sound('click');
    refresh();
  }

  function onBack() {
    sound('click');
    try { NB.Router.back(); } catch (e) { /* нет истории переходов */ }
  }

  function onSettled() {
    // новый раунд записан — перечитываем историю, пока экран открыт
    if (!mounted) return;
    loadHistory();
    refresh();
  }

  /* ---------- Каркас экрана ---------- */
  function gameOptions() {
    const seen = {};
    const opts = ['<option value="all">Все игры</option>'];
    let games = [];
    try { games = NB.Games && NB.Games.getAll ? NB.Games.getAll() : []; } catch (e) { games = []; }
    games.forEach(g => {
      seen[g.id] = true;
      opts.push('<option value="' + esc(g.id) + '">' + esc((g.icon || '🎲') + ' ' + g.name) + '</option>');
    });
    // игры из истории, которых нет в реестре
    all.forEach(r => {
      if (r.gameId != null && !seen[r.gameId]) {
        seen[r.gameId] = true;
        opts.push('<option value="' + esc(r.gameId) + '">' + esc(gameInfo(r.gameId).name) + '</option>');
      }
    });
    return opts.join('');
  }

  function seg(kind, items) {
    return '<div class="hs-seg" role="group">' + items.map(it =>
      '<button type="button" class="hs-seg-btn" data-seg="' + kind + '" data-val="' + it[0] + '">' + it[1] + '</button>'
    ).join('') + '</div>';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.hs-root{box-sizing:border-box;min-height:100%;padding:12px 12px 32px;color:#eee9ff;background:#0d0a1a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-tap-highlight-color:transparent}',
      '.hs-root *{box-sizing:border-box}',
      '.hs-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}',
      '.hs-head h2{margin:0;font-size:20px;color:#ffd54a;text-shadow:0 0 10px rgba(255,213,74,.45)}',
      '.hs-back{min-width:44px;min-height:44px;border-radius:12px;border:1px solid #6b3bd1;background:#1a1333;color:#d9c2ff;font-size:20px;cursor:pointer}',
      '.hs-panel{background:#150f29;border:1px solid #3a2670;border-radius:16px;padding:12px;margin-bottom:12px;box-shadow:0 0 14px rgba(140,80,255,.18)}',
      '.hs-field{display:block;margin-bottom:10px}',
      '.hs-field>span{display:block;font-size:12px;color:#a897d6;margin-bottom:4px}',
      '.hs-select,.hs-input{width:100%;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid #4a318a;background:#0d0a1a;color:#fff;font-size:16px}',
      '.hs-select:focus,.hs-input:focus{outline:none;border-color:#b36bff;box-shadow:0 0 8px rgba(179,107,255,.6)}',
      '.hs-seg{display:flex;gap:6px;margin-bottom:10px}',
      '.hs-seg-btn{flex:1;min-height:44px;border-radius:12px;border:1px solid #4a318a;background:#0d0a1a;color:#c9b8f5;font-size:14px;font-weight:600;cursor:pointer}',
      '.hs-seg-btn.hs-on{background:linear-gradient(135deg,#7a3dff,#b36bff);color:#fff;border-color:#c9a0ff;box-shadow:0 0 10px rgba(179,107,255,.6)}',
      '.hs-range{display:flex;gap:8px;margin-bottom:10px}',
      '.hs-range .hs-input{flex:1;min-width:0}',
      '.hs-reset{width:100%;min-height:44px;border-radius:12px;border:1px solid #ffd54a;background:transparent;color:#ffd54a;font-size:15px;font-weight:600;cursor:pointer}',
      '.hs-sum-title{font-size:13px;color:#a897d6;margin-bottom:8px}',
      '.hs-sum-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.hs-tile{background:#0d0a1a;border:1px solid #2e1f58;border-radius:12px;padding:8px 10px}',
      '.hs-tile span{display:block;font-size:11px;color:#8f7fc0}',
      '.hs-tile b{font-size:16px;color:#fff}',
      '.hs-sum-foot{margin-top:8px;font-size:12px;color:#8f7fc0}',
      '.hs-win-t{color:#ffd54a!important}',
      '.hs-lose-t{color:#ff5c7a!important}',
      '.hs-push-t{color:#9aa0b8!important}',
      '.hs-day{margin:14px 4px 6px;font-size:13px;font-weight:700;color:#b36bff;text-transform:uppercase;letter-spacing:.04em}',
      '.hs-card{background:#150f29;border:1px solid #2e1f58;border-left:4px solid #5a5f78;border-radius:14px;margin-bottom:8px;overflow:hidden}',
      '.hs-card.hs-win{border-left-color:#ffd54a}',
      '.hs-card.hs-lose{border-left-color:#ff5c7a}',
      '.hs-card.hs-open{border-color:#6b3bd1;box-shadow:0 0 12px rgba(140,80,255,.3)}',
      '.hs-card-head{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:8px 12px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.hs-ico{font-size:26px;width:36px;text-align:center}',
      '.hs-main{flex:1;min-width:0;display:flex;flex-direction:column}',
      '.hs-main b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.hs-main small,.hs-amt small{font-size:12px;color:#8f7fc0}',
      '.hs-amt{display:flex;flex-direction:column;align-items:flex-end}',
      '.hs-amt b{font-size:16px}',
      '.hs-body{padding:4px 12px 12px;border-top:1px dashed #3a2670}',
      '.hs-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:14px;border-bottom:1px solid rgba(80,60,140,.25)}',
      '.hs-row span{color:#a897d6}',
      '.hs-row b{text-align:right;word-break:break-word;max-width:65%}',
      '.hs-sub{margin:10px 0 2px;font-size:12px;color:#ffd54a;text-transform:uppercase;letter-spacing:.05em}',
      '.hs-empty-d,.hs-detail-text{padding:6px 0;font-size:13px;color:#8f7fc0;word-break:break-word}',
      '.hs-empty{padding:40px 16px;text-align:center;color:#8f7fc0;font-size:15px;line-height:1.6}',
      '.hs-more{text-align:center;padding:8px 0}',
      '.hs-more-btn{min-height:48px;padding:0 24px;border-radius:14px;border:1px solid #b36bff;background:#1a1333;color:#e6d6ff;font-size:15px;font-weight:600;cursor:pointer}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------- Монтирование / размонтирование ---------- */
  function mount(container, params) {
    if (!container) return;
    unmount(); // на случай повторного входа
    injectStyle();
    mounted = true;

    filters = { game: 'all', result: 'all', field: 'bet', min: '', max: '' };
    loadHistory();
    if (params && params.gameId) filters.game = params.gameId;

    root = document.createElement('div');
    root.className = 'hs-root';
    root.innerHTML =
      '<div class="hs-head">' +
        '<button type="button" class="hs-back" data-act="back" aria-label="Назад">←</button>' +
        '<h2>📜 История ставок</h2>' +
      '</div>' +
      '<div class="hs-panel">' +
        '<label class="hs-field"><span>Игра</span><select class="hs-select" data-el="game">' + gameOptions() + '</select></label>' +
        seg('result', [['all', 'Все'], ['win', 'Выигрыши'], ['lose', 'Проигрыши']]) +
        '<div class="hs-field"><span>Диапазон суммы</span></div>' +
        seg('field', [['bet', 'По ставке'], ['payout', 'По выплате']]) +
        '<div class="hs-range">' +
          '<input class="hs-input" data-el="min" type="text" inputmode="numeric" placeholder="От" autocomplete="off">' +
          '<input class="hs-input" data-el="max" type="text" inputmode="numeric" placeholder="До" autocomplete="off">' +
        '</div>' +
        '<button type="button" class="hs-reset" data-act="reset">Сбросить фильтры</button>' +
      '</div>' +
      '<div class="hs-panel" data-el="summary"></div>' +
      '<div data-el="list"></div>' +
      '<div class="hs-more" data-el="more" hidden>' +
        '<button type="button" class="hs-more-btn" data-el="moreBtn">Показать ещё</button>' +
      '</div>';

    container.appendChild(root);

    els = {
      game: root.querySelector('[data-el="game"]'),
      min: root.querySelector('[data-el="min"]'),
      max: root.querySelector('[data-el="max"]'),
      summary: root.querySelector('[data-el="summary"]'),
      list: root.querySelector('[data-el="list"]'),
      more: root.querySelector('[data-el="more"]'),
      moreBtn: root.querySelector('[data-el="moreBtn"]')
    };

    // если переданной игры нет в списке — сбрасываем фильтр
    els.game.value = filters.game;
    if (els.game.value !== filters.game) { filters.game = 'all'; els.game.value = 'all'; }

    root.querySelector('[data-act="back"]').addEventListener('click', onBack);
    root.querySelector('[data-act="reset"]').addEventListener('click', onReset);
    els.game.addEventListener('change', onGameChange);
    els.min.addEventListener('input', onAmountInput);
    els.max.addEventListener('input', onAmountInput);
    els.list.addEventListener('click', onListClick);
    els.moreBtn.addEventListener('click', renderMore);
    root.addEventListener('click', onSegClick);

    if (NB.Events) NB.Events.on('round:settled', onSettled);

    updateSegs();
    refresh();
  }

  function unmount() {
    mounted = false;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    detach();
    observer = null;
    if (NB.Events) NB.Events.off('round:settled', onSettled);
    if (root) {
      // обработчики висят на узлах внутри root — снимаются вместе с ним
      if (root.parentNode) root.parentNode.removeChild(root);
    }
    root = null;
    els = {};
    all = [];
    filtered = [];
    shown = 0;
    lastDayKey = null;
  }

  /* ---------- Регистрация экрана ---------- */
  if (NB.Router && typeof NB.Router.register === 'function') {
    NB.Router.register(SCREEN_ID, { mount: mount, unmount: unmount });
  }

  NB.HistoryScreen = { id: SCREEN_ID, mount: mount, unmount: unmount };
})();