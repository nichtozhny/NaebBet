/* ============================================================================
 * NaebBet — js/screens/rulesScreen.js
 * Экран «Центр инструкций»: список игр с поиском, подробные правила игры,
 * раздел «Основы» (RTP, банкролл, виртуальная валюта), кнопка «Играть».
 * Регистрируется в роутере как экран "rules".
 * Параметры при открытии: { gameId } — сразу открыть правила конкретной игры,
 *                         { tab: 'games' | 'basics' } — стартовая вкладка.
 * ========================================================================== */
(function () {
  'use strict';

  var root = (typeof window !== 'undefined') ? window : globalThis;
  var NB = root.NB = root.NB || {};

  var SCREEN_ID = 'rules';
  var STYLE_ID = 'nb-rules-screen-style';

  // ---------------------------------------------------------------------------
  // Состояние экрана (сбрасывается при каждом mount)
  // ---------------------------------------------------------------------------
  var state = null;

  function freshState(params) {
    params = params || {};
    return {
      container: null,
      tab: params.tab === 'basics' ? 'basics' : 'games',
      query: '',
      openGameId: params.gameId || null,
      searchTimer: null,
      onClick: null,
      onInput: null,
      mounted: false
    };
  }

  // ---------------------------------------------------------------------------
  // Вспомогательные функции
  // ---------------------------------------------------------------------------

  /** Экранирование HTML, чтобы текст правил не ломал разметку */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Звук клика (безопасно, если NB.Audio ещё не готов) */
  function click() {
    try { if (NB.Audio && NB.Audio.play) NB.Audio.play('click'); } catch (e) { /* игнор */ }
  }

  /** Безопасный toast */
  function toast(text, type) {
    try {
      if (NB.UI && NB.UI.toast) NB.UI.toast(text, type || 'info');
    } catch (e) { /* игнор */ }
  }

  /** Форматирование денег через NB.UI, с запасным вариантом */
  function money(n) {
    try {
      if (NB.UI && NB.UI.formatMoney) return NB.UI.formatMoney(n);
    } catch (e) { /* игнор */ }
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /** Нормализация RTP: 0.96 -> "96", 96 -> "96", 96.5 -> "96.5" */
  function formatRtp(rtp) {
    var n = Number(rtp);
    if (!isFinite(n) || n <= 0) return '—';
    if (n <= 1) n *= 100;
    var s = n.toFixed(1);
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    return s + '%';
  }

  /** Список игр (всегда массив) */
  function getGames() {
    try {
      var list = NB.Games && NB.Games.getAll ? NB.Games.getAll() : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  /** Получить данные правил игры (или null) */
  function getRulesData(gameId) {
    try {
      return NB.Rules && NB.Rules.get ? (NB.Rules.get(gameId) || null) : null;
    } catch (e) {
      return null;
    }
  }

  /** Найти игру по id */
  function findGame(gameId) {
    try {
      var g = NB.Games && NB.Games.get ? NB.Games.get(gameId) : null;
      if (g) return g;
    } catch (e) { /* игнор */ }
    var all = getGames();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === gameId) return all[i];
    }
    return null;
  }

  /** Преобразовать элемент таблицы выплат/FAQ в строки для вывода */
  function pairOf(item, keysA, keysB) {
    if (item == null) return ['', ''];
    if (typeof item !== 'object') return [String(item), ''];
    var a = '', b = '', i;
    for (i = 0; i < keysA.length; i++) {
      if (item[keysA[i]] != null) { a = item[keysA[i]]; break; }
    }
    for (i = 0; i < keysB.length; i++) {
      if (item[keysB[i]] != null) { b = item[keysB[i]]; break; }
    }
    return [String(a), String(b)];
  }

  // ---------------------------------------------------------------------------
  // Стили (инжектируются один раз, префикс .nbr-)
  // ---------------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.nbr-wrap{min-height:100%;box-sizing:border-box;padding:12px 14px calc(24px + env(safe-area-inset-bottom,0px));background:#0b0715;color:#e9e4ff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}',
      '.nbr-wrap *{box-sizing:border-box}',
      '.nbr-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}',
      '.nbr-back{min-width:44px;min-height:44px;border-radius:14px;border:1px solid #3a2a6b;background:#150e29;color:#ffd35c;font-size:22px;line-height:1;cursor:pointer}',
      '.nbr-back:active{transform:scale(.95)}',
      '.nbr-title{margin:0;font-size:20px;font-weight:800;letter-spacing:.3px;background:linear-gradient(90deg,#b678ff,#ffd35c);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}',
      '.nbr-tabs{display:flex;gap:8px;margin-bottom:12px}',
      '.nbr-tab{flex:1;min-height:46px;border-radius:14px;border:1px solid #3a2a6b;background:#150e29;color:#bfb2ea;font-size:15px;font-weight:700;cursor:pointer}',
      '.nbr-tab.is-active{border-color:#b678ff;color:#fff;background:linear-gradient(180deg,#34196b,#1d0f3d);box-shadow:0 0 14px rgba(182,120,255,.45)}',
      '.nbr-search{position:relative;margin-bottom:12px}',
      '.nbr-search input{width:100%;min-height:48px;padding:0 44px 0 44px;border-radius:14px;border:1px solid #3a2a6b;background:#120b24;color:#fff;font-size:16px;outline:none}',
      '.nbr-search input:focus{border-color:#ffd35c;box-shadow:0 0 12px rgba(255,211,92,.35)}',
      '.nbr-search .nbr-si{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:18px;pointer-events:none}',
      '.nbr-search .nbr-clear{position:absolute;right:2px;top:2px;width:44px;height:44px;border:0;background:transparent;color:#bfb2ea;font-size:20px;cursor:pointer}',
      '.nbr-list{display:flex;flex-direction:column;gap:10px}',
      '.nbr-card{display:flex;align-items:center;gap:12px;width:100%;min-height:72px;padding:12px;border-radius:16px;border:1px solid #33235f;background:linear-gradient(180deg,#1a1033,#120a25);color:inherit;text-align:left;cursor:pointer;font:inherit}',
      '.nbr-card:active{transform:scale(.98);border-color:#b678ff}',
      '.nbr-ico{flex:0 0 52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:30px;background:#0d0719;border:1px solid #3a2a6b;box-shadow:inset 0 0 12px rgba(182,120,255,.25)}',
      '.nbr-info{flex:1;min-width:0}',
      '.nbr-name{font-size:16px;font-weight:800;color:#fff;margin:0 0 2px}',
      '.nbr-desc{font-size:13px;color:#a99fd0;margin:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.nbr-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}',
      '.nbr-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;background:#241448;color:#d7c8ff;border:1px solid #3a2a6b}',
      '.nbr-badge.gold{color:#ffd35c;border-color:#7a6320;background:#2a210a}',
      '.nbr-badge.warn{color:#ff9aa8;border-color:#6b2a3a;background:#2a0f17}',
      '.nbr-arrow{color:#ffd35c;font-size:20px}',
      '.nbr-empty{text-align:center;color:#a99fd0;padding:36px 12px;font-size:15px}',
      '.nbr-empty b{display:block;font-size:40px;margin-bottom:8px}',
      '.nbr-count{font-size:12px;color:#8277ad;margin:0 2px 8px}',
      /* страница правил */
      '.nbr-hero{display:flex;align-items:center;gap:12px;padding:14px;border-radius:18px;border:1px solid #4a2f8f;background:linear-gradient(135deg,#27114f,#140a2b);box-shadow:0 0 18px rgba(182,120,255,.3);margin-bottom:12px}',
      '.nbr-hero .nbr-ico{flex-basis:60px;height:60px;font-size:34px}',
      '.nbr-hero h2{margin:0;font-size:20px;color:#fff}',
      '.nbr-hero p{margin:4px 0 0;font-size:13px;color:#b9acea}',
      '.nbr-sec{margin-bottom:12px;padding:14px;border-radius:16px;border:1px solid #33235f;background:#120a25}',
      '.nbr-sec h3{margin:0 0 8px;font-size:16px;color:#ffd35c}',
      '.nbr-sec p{margin:0 0 8px;font-size:14px;line-height:1.5;color:#dcd3fa}',
      '.nbr-sec p:last-child{margin-bottom:0}',
      '.nbr-sec ol,.nbr-sec ul{margin:0;padding-left:22px;font-size:14px;line-height:1.55;color:#dcd3fa}',
      '.nbr-sec li{margin-bottom:6px}',
      '.nbr-table{width:100%;border-collapse:collapse;font-size:14px}',
      '.nbr-table td{padding:9px 6px;border-bottom:1px solid #2a1b50;vertical-align:top}',
      '.nbr-table tr:last-child td{border-bottom:0}',
      '.nbr-table td:last-child{text-align:right;color:#ffd35c;font-weight:800;white-space:nowrap;padding-left:10px}',
      '.nbr-faq{border-bottom:1px solid #2a1b50}',
      '.nbr-faq:last-child{border-bottom:0}',
      '.nbr-faq summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:700;font-size:14px;color:#fff;list-style:none}',
      '.nbr-faq summary::-webkit-details-marker{display:none}',
      '.nbr-faq summary::before{content:"▸";color:#b678ff;margin-right:8px}',
      '.nbr-faq[open] summary::before{content:"▾"}',
      '.nbr-faq div{padding:0 0 10px 18px;font-size:14px;line-height:1.5;color:#cfc4f3}',
      '.nbr-play{position:sticky;bottom:calc(10px + env(safe-area-inset-bottom,0px));display:block;width:100%;min-height:56px;margin-top:14px;border:0;border-radius:16px;font-size:18px;font-weight:900;letter-spacing:.5px;color:#1a1000;cursor:pointer;background:linear-gradient(180deg,#ffe28a,#ffb800);box-shadow:0 0 22px rgba(255,200,60,.55),0 6px 18px rgba(0,0,0,.5)}',
      '.nbr-play:active{transform:scale(.98)}',
      '.nbr-note{font-size:12px;color:#8f84b8;text-align:center;margin-top:12px;line-height:1.4}',
      /* основы */
      '.nbr-basic{margin-bottom:10px;border-radius:16px;border:1px solid #33235f;background:linear-gradient(180deg,#1a1033,#120a25);overflow:hidden}',
      '.nbr-basic>summary{min-height:56px;padding:10px 14px;display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;font-size:16px;font-weight:800;color:#fff}',
      '.nbr-basic>summary::-webkit-details-marker{display:none}',
      '.nbr-basic>summary .nbr-bi{font-size:26px}',
      '.nbr-basic>summary::after{content:"▸";margin-left:auto;color:#ffd35c}',
      '.nbr-basic[open]>summary::after{content:"▾"}',
      '.nbr-basic[open]{border-color:#b678ff;box-shadow:0 0 14px rgba(182,120,255,.3)}',
      '.nbr-bbody{padding:0 14px 14px;font-size:14px;line-height:1.55;color:#dcd3fa}',
      '.nbr-bbody p{margin:0 0 10px}',
      '.nbr-bbody ul{margin:0 0 10px;padding-left:20px}',
      '.nbr-bbody li{margin-bottom:5px}',
      '.nbr-formula{padding:10px 12px;border-radius:12px;background:#0d0719;border:1px dashed #5a3fa8;color:#ffd35c;font-weight:700;margin:0 0 10px}',
      '.nbr-bbody b{color:#fff}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------
  // Рендер: вкладка «Игры»
  // ---------------------------------------------------------------------------

  /** Фильтрация игр по строке поиска (название, описание, категория, id, цель) */
  function filterGames(query) {
    var games = getGames();
    var q = String(query || '').trim().toLowerCase();
    if (!q) return games;
    return games.filter(function (g) {
      var rules = getRulesData(g.id) || {};
      var hay = [g.name, g.description, g.category, g.id, rules.title, rules.goal]
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function gameCardHtml(g) {
    var hasRules = !!getRulesData(g.id);
    var badges = '';
    if (g.category) badges += '<span class="nbr-badge">' + esc(g.category) + '</span>';
    if (g.rtp != null) badges += '<span class="nbr-badge gold">RTP ' + esc(formatRtp(g.rtp)) + '</span>';
    if (g.minBet != null && g.maxBet != null) {
      badges += '<span class="nbr-badge">' + esc(money(g.minBet)) + '–' + esc(money(g.maxBet)) + '</span>';
    }
    if (!hasRules) badges += '<span class="nbr-badge warn">правил пока нет</span>';
    return '' +
      '<button type="button" class="nbr-card" data-act="open" data-id="' + esc(g.id) + '">' +
        '<span class="nbr-ico">' + esc(g.icon || '🎲') + '</span>' +
        '<span class="nbr-info">' +
          '<p class="nbr-name">' + esc(g.name || g.id) + '</p>' +
          (g.description ? '<p class="nbr-desc">' + esc(g.description) + '</p>' : '') +
          '<span class="nbr-meta">' + badges + '</span>' +
        '</span>' +
        '<span class="nbr-arrow">›</span>' +
      '</button>';
  }

  /** Только список карточек (для обновления при вводе без потери фокуса поля) */
  function listHtml() {
    var found = filterGames(state.query);
    if (!getGames().length) {
      return '<div class="nbr-empty"><b>🎰</b>Игры ещё не добавлены.</div>';
    }
    if (!found.length) {
      return '<div class="nbr-empty"><b>🔍</b>Ничего не найдено по запросу «' +
        esc(state.query) + '».<br>Попробуйте другое слово.</div>';
    }
    return '<p class="nbr-count">Найдено игр: ' + found.length + '</p>' +
      '<div class="nbr-list">' + found.map(gameCardHtml).join('') + '</div>';
  }

  function gamesTabHtml() {
    return '' +
      '<div class="nbr-search">' +
        '<span class="nbr-si">🔍</span>' +
        '<input type="search" data-role="search" placeholder="Поиск игры или правила…" ' +
          'autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(state.query) + '">' +
        '<button type="button" class="nbr-clear" data-act="clear" aria-label="Очистить"' +
          (state.query ? '' : ' style="display:none"') + '>✕</button>' +
      '</div>' +
      '<div data-role="list">' + listHtml() + '</div>';
  }

  // ---------------------------------------------------------------------------
  // Рендер: вкладка «Основы»
  // ---------------------------------------------------------------------------
  function basicsTabHtml() {
    var start = 10000;
    try {
      var bal = NB.Wallet && NB.Wallet.getBalance ? NB.Wallet.getBalance() : null;
      if (bal != null) start = bal;
    } catch (e) { /* игнор */ }

    return '' +
      '<details class="nbr-basic" open>' +
        '<summary><span class="nbr-bi">📊</span>Что такое RTP</summary>' +
        '<div class="nbr-bbody">' +
          '<p><b>RTP (Return To Player)</b> — теоретический процент ставок, который игра возвращает игрокам <b>на очень длинной дистанции</b>.</p>' +
          '<div class="nbr-formula">RTP 96% → в среднем 96 монет из каждых 100 поставленных возвращаются игрокам</div>' +
          '<p>Оставшиеся проценты — <b>преимущество казино</b> (house edge). При RTP 96% оно равно 4%.</p>' +
          '<ul>' +
            '<li>RTP — это среднее по <b>миллионам</b> раундов, а не прогноз на ближайшие 10 или 100 игр.</li>' +
            '<li>Короткая серия может быть как заметно выше, так и заметно ниже RTP — это нормальная дисперсия.</li>' +
            '<li>Предыдущие раунды <b>не влияют</b> на следующие: монета и рулетка не «помнят» прошлого.</li>' +
            '<li>Чем выше RTP, тем выгоднее игра в долгосрочной перспективе, но выигрыш никогда не гарантирован.</li>' +
          '</ul>' +
        '</div>' +
      '</details>' +

      '<details class="nbr-basic">' +
        '<summary><span class="nbr-bi">🏦</span>Банкролл и управление ставками</summary>' +
        '<div class="nbr-bbody">' +
          '<p><b>Банкролл</b> — это сумма, которую вы готовы использовать для игры. В NaebBet это ваш баланс NB-монет.</p>' +
          '<ul>' +
            '<li><b>Делите банк на сессии.</b> Заранее решите, сколько монет вы готовы потратить за один заход.</li>' +
            '<li><b>Держите ставку небольшой.</b> Разумная ставка — 1–5% от банка: так вы переживёте серию неудач.</li>' +
            '<li><b>Не догоняйте проигрыш.</b> Повышение ставки после поражения — быстрый путь к обнулению баланса.</li>' +
            '<li><b>Фиксируйте цель.</b> Определите, при каком выигрыше вы останавливаетесь, и придерживайтесь этого.</li>' +
            '<li><b>Делайте паузы.</b> Игра — это развлечение, а не способ заработка.</li>' +
          '</ul>' +
          '<p>Сейчас на вашем балансе: <b>' + esc(money(start)) + ' NB</b>.</p>' +
        '</div>' +
      '</details>' +

      '<details class="nbr-basic">' +
        '<summary><span class="nbr-bi">🪙</span>Виртуальная валюта NB-монеты</summary>' +
        '<div class="nbr-bbody">' +
          '<p><b>NB-монеты — игровая валюта.</b> Они не имеют реальной стоимости, не покупаются за деньги и не выводятся.</p>' +
          '<ul>' +
            '<li>Стартовый баланс — <b>10 000 NB</b>.</li>' +
            '<li>Всё работает офлайн, данные хранятся только на вашем устройстве.</li>' +
            '<li>Выигрыши и проигрыши влияют только на ваш баланс, статистику, уровень и достижения.</li>' +
            '<li>Если монеты закончились, прогресс можно сбросить в настройках и начать заново.</li>' +
          '</ul>' +
          '<p>NaebBet — это симулятор для развлечения и обучения основам вероятности. Он <b>не</b> подготовка к игре на реальные деньги.</p>' +
        '</div>' +
      '</details>' +

      '<details class="nbr-basic">' +
        '<summary><span class="nbr-bi">🎲</span>Честность и случайность</summary>' +
        '<div class="nbr-bbody">' +
          '<p>Результаты игр определяются генератором случайных чисел на основе криптографического источника браузера (<b>crypto.getRandomValues</b>).</p>' +
          '<ul>' +
            '<li>Исход не зависит от времени, баланса или размера ставки.</li>' +
            '<li>Не существует «горячих» и «холодных» серий, которые можно предсказать.</li>' +
            '<li>Никакая система ставок не меняет математическое ожидание игры.</li>' +
          '</ul>' +
        '</div>' +
      '</details>' +

      '<details class="nbr-basic">' +
        '<summary><span class="nbr-bi">🧠</span>Принципы ответственной игры</summary>' +
        '<div class="nbr-bbody">' +
          '<ul>' +
            '<li>Играйте ради удовольствия, а не ради «отыгрыша».</li>' +
            '<li>Установите лимит времени и придерживайтесь его.</li>' +
            '<li>Если игра перестаёт радовать — сделайте перерыв.</li>' +
            '<li>Помните: в реальных азартных играх можно потерять настоящие деньги. Если вы чувствуете, что теряете контроль, обратитесь за помощью к близким или специалистам.</li>' +
          '</ul>' +
        '</div>' +
      '</details>';
  }

  // ---------------------------------------------------------------------------
  // Рендер: страница правил конкретной игры
  // ---------------------------------------------------------------------------

  /** Собственная отрисовка правил (запасной вариант, если NB.Rules.renderRules недоступен) */
  function fallbackRulesHtml(gameId) {
    var r = getRulesData(gameId);
    if (!r) {
      return '<div class="nbr-empty"><b>📭</b>Для этой игры правила пока не добавлены.</div>';
    }
    var html = '';

    if (r.goal) {
      html += '<div class="nbr-sec"><h3>🎯 Цель игры</h3><p>' + esc(r.goal) + '</p></div>';
    }
    if (Array.isArray(r.howToPlay) && r.howToPlay.length) {
      html += '<div class="nbr-sec"><h3>📖 Как играть</h3><ol>' +
        r.howToPlay.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ol></div>';
    }
    if (Array.isArray(r.payouts) && r.payouts.length) {
      html += '<div class="nbr-sec"><h3>💰 Выплаты</h3><table class="nbr-table"><tbody>' +
        r.payouts.map(function (p) {
          var pr = pairOf(p, ['name', 'combo', 'title', 'label', 'bet'], ['pay', 'payout', 'multiplier', 'value', 'win']);
          return '<tr><td>' + esc(pr[0]) + '</td><td>' + esc(pr[1]) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>';
    }
    if (Array.isArray(r.tips) && r.tips.length) {
      html += '<div class="nbr-sec"><h3>💡 Советы</h3><ul>' +
        r.tips.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
        '</ul></div>';
    }
    if (Array.isArray(r.faq) && r.faq.length) {
      html += '<div class="nbr-sec"><h3>❓ Частые вопросы</h3>' +
        r.faq.map(function (f) {
          var pr = pairOf(f, ['q', 'question', 'title'], ['a', 'answer', 'text']);
          return '<details class="nbr-faq"><summary>' + esc(pr[0]) + '</summary><div>' + esc(pr[1]) + '</div></details>';
        }).join('') +
        '</div>';
    }
    return html || '<div class="nbr-empty"><b>📭</b>Описание правил пусто.</div>';
  }

  /**
   * Наполнить контейнер правилами: сначала пробуем NB.Rules.renderRules(container, gameId),
   * при отсутствии/ошибке/пустом результате — собственная отрисовка.
   */
  function fillRules(box, gameId) {
    var done = false;
    try {
      if (NB.Rules && typeof NB.Rules.renderRules === 'function') {
        var res = NB.Rules.renderRules(box, gameId);
        if (typeof res === 'string' && res) {
          box.innerHTML = res;
        } else if (res && res.nodeType === 1 && !box.contains(res)) {
          box.appendChild(res);
        }
        done = box.childNodes.length > 0 && box.textContent.trim().length > 0;
      }
    } catch (e) {
      done = false;
    }
    if (!done) box.innerHTML = fallbackRulesHtml(gameId);
  }

  function gameHeroHtml(game, gameId) {
    var rules = getRulesData(gameId) || {};
    var name = (game && game.name) || rules.title || gameId;
    var icon = (game && game.icon) || '🎲';
    var parts = [];
    if (game && game.rtp != null) parts.push('RTP ' + formatRtp(game.rtp));
    if (game && game.minBet != null && game.maxBet != null) {
      parts.push('ставка ' + money(game.minBet) + '–' + money(game.maxBet));
    }
    return '' +
      '<div class="nbr-hero">' +
        '<span class="nbr-ico">' + esc(icon) + '</span>' +
        '<div>' +
          '<h2>' + esc(name) + '</h2>' +
          '<p>' + esc(parts.join(' · ') || (game && game.description) || 'Правила игры') + '</p>' +
        '</div>' +
      '</div>';
  }

  // ---------------------------------------------------------------------------
  // Главный рендер экрана
  // ---------------------------------------------------------------------------
  function render() {
    if (!state || !state.container) return;
    var c = state.container;
    var html;

    // --- Страница правил выбранной игры ---
    if (state.openGameId) {
      var gid = state.openGameId;
      var game = findGame(gid);
      html = '' +
        '<div class="nbr-wrap">' +
          '<div class="nbr-top">' +
            '<button type="button" class="nbr-back" data-act="back" aria-label="Назад">‹</button>' +
            '<h1 class="nbr-title">Правила игры</h1>' +
          '</div>' +
          gameHeroHtml(game, gid) +
          '<div data-role="rules-box"></div>' +
          (game
            ? '<button type="button" class="nbr-play" data-act="play" data-id="' + esc(gid) + '">▶ ИГРАТЬ</button>'
            : '') +
          '<p class="nbr-note">NB-монеты — виртуальная валюта. Реальных денег в игре нет.</p>' +
        '</div>';
      c.innerHTML = html;
      fillRules(c.querySelector('[data-role="rules-box"]'), gid);
      scrollTop();
      return;
    }

    // --- Главная страница центра инструкций ---
    html = '' +
      '<div class="nbr-wrap">' +
        '<div class="nbr-top">' +
          '<button type="button" class="nbr-back" data-act="back" aria-label="Назад">‹</button>' +
          '<h1 class="nbr-title">📘 Центр инструкций</h1>' +
        '</div>' +
        '<div class="nbr-tabs">' +
          '<button type="button" class="nbr-tab' + (state.tab === 'games' ? ' is-active' : '') + '" data-act="tab" data-tab="games">🎮 Игры</button>' +
          '<button type="button" class="nbr-tab' + (state.tab === 'basics' ? ' is-active' : '') + '" data-act="tab" data-tab="basics">📚 Основы</button>' +
        '</div>' +
        (state.tab === 'games' ? gamesTabHtml() : basicsTabHtml()) +
      '</div>';
    c.innerHTML = html;
    scrollTop();
  }

  /** Прокрутка к началу при смене страницы */
  function scrollTop() {
    try {
      if (state.container && state.container.scrollTo) state.container.scrollTo(0, 0);
      if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
    } catch (e) { /* игнор */ }
  }

  /** Обновить только список игр (без перерисовки поля поиска — не теряем клавиатуру) */
  function refreshList() {
    if (!state || !state.container) return;
    var list = state.container.querySelector('[data-role="list"]');
    if (list) list.innerHTML = listHtml();
    var clr = state.container.querySelector('[data-act="clear"]');
    if (clr) clr.style.display = state.query ? '' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Действия
  // ---------------------------------------------------------------------------

  /** Запуск игры из страницы правил */
  function playGame(gameId) {
    var game = findGame(gameId);
    if (!game) {
      toast('Игра недоступна', 'error');
      return;
    }
    try {
      if (NB.Events && NB.Events.emit) NB.Events.emit('rules:play', { gameId: gameId });
    } catch (e) { /* игнор */ }
    try {
      NB.Router.go('game', { gameId: gameId, id: gameId });
    } catch (err) {
      toast('Не удалось открыть игру', 'error');
    }
  }

  /** Кнопка «Назад»: со страницы правил — к списку, из списка — на предыдущий экран */
  function goBack() {
    if (state.openGameId) {
      state.openGameId = null;
      render();
      return;
    }
    try {
      NB.Router.back();
    } catch (e) {
      try { NB.Router.go('home'); } catch (e2) { /* игнор */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Обработчики событий (делегирование на контейнер)
  // ---------------------------------------------------------------------------
  function handleClick(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el || !state || !state.container.contains(el)) return;
    var act = el.getAttribute('data-act');

    if (act === 'open') {
      click();
      state.openGameId = el.getAttribute('data-id');
      render();
    } else if (act === 'back') {
      click();
      goBack();
    } else if (act === 'tab') {
      var tab = el.getAttribute('data-tab');
      if (tab !== state.tab) {
        click();
        state.tab = tab;
        render();
      }
    } else if (act === 'clear') {
      click();
      state.query = '';
      var inp = state.container.querySelector('[data-role="search"]');
      if (inp) { inp.value = ''; inp.focus(); }
      refreshList();
    } else if (act === 'play') {
      click();
      playGame(el.getAttribute('data-id'));
    }
  }

  function handleInput(ev) {
    var t = ev.target;
    if (!t || t.getAttribute('data-role') !== 'search') return;
    var value = t.value;
    // Небольшой debounce, чтобы не перерисовывать список на каждый символ
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(function () {
      state.searchTimer = null;
      if (!state) return;
      state.query = value;
      refreshList();
    }, 120);
  }

  // ---------------------------------------------------------------------------
  // Жизненный цикл экрана
  // ---------------------------------------------------------------------------
  function mount(container, params) {
    if (state && state.mounted) unmount();
    injectStyle();
    state = freshState(params);
    state.container = container;
    state.mounted = true;

    state.onClick = handleClick;
    state.onInput = handleInput;
    container.addEventListener('click', state.onClick);
    container.addEventListener('input', state.onInput);

    render();
  }

  function unmount() {
    if (!state) return;
    if (state.searchTimer) {
      clearTimeout(state.searchTimer);
      state.searchTimer = null;
    }
    if (state.container) {
      if (state.onClick) state.container.removeEventListener('click', state.onClick);
      if (state.onInput) state.container.removeEventListener('input', state.onInput);
      state.container.innerHTML = '';
    }
    state.mounted = false;
    state = null;
  }

  // ---------------------------------------------------------------------------
  // Публичный модуль и регистрация экрана
  // ---------------------------------------------------------------------------
  NB.RulesScreen = {
    id: SCREEN_ID,
    mount: mount,
    unmount: unmount,
    /** Удобный хелпер: открыть центр инструкций (опционально сразу на правилах игры) */
    open: function (gameId) {
      NB.Router.go(SCREEN_ID, gameId ? { gameId: gameId } : {});
    }
  };

  if (NB.Router && typeof NB.Router.register === 'function') {
    NB.Router.register(SCREEN_ID, { mount: mount, unmount: unmount });
  }
})();