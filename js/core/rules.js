/* ============================================================
 * NaebBet — js/core/rules.js
 * Модуль NB.Rules: хранилище правил игр, поиск и рендер аккордеона.
 * Только чистый JS, без зависимостей (кроме опциональных NB.*).
 * ============================================================ */
(function (global) {
  'use strict';

  var NB = global.NB = global.NB || {};

  // Внутреннее хранилище: gameId -> нормализованная запись
  var store = Object.create(null);
  // Порядок регистрации (для стабильного getAll)
  var order = [];

  // Один раз вставляем стили аккордеона
  var stylesInjected = false;

  /* ---------- Вспомогательные функции ---------- */

  // Безопасное приведение к строке
  function str(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }

  // Приведение к массиву строк (пустые отбрасываем)
  function strArray(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var s = str(v[i]).trim();
      if (s) out.push(s);
    }
    return out;
  }

  // Экранирование HTML (весь текст правил выводим как текст)
  function esc(s) {
    return str(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Глубокая копия простых данных (чтобы снаружи нельзя было испортить хранилище)
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Нормализация записи правил к единому формату
  function normalize(gameId, data) {
    data = data || {};

    var payouts = [];
    if (Array.isArray(data.payouts)) {
      for (var i = 0; i < data.payouts.length; i++) {
        var p = data.payouts[i];
        if (p && typeof p === 'object') {
          payouts.push({ name: str(p.name), value: str(p.value) });
        } else if (p !== null && p !== undefined) {
          // Допускаем простую строку как "название без значения"
          payouts.push({ name: str(p), value: '' });
        }
      }
    }

    var faq = [];
    if (Array.isArray(data.faq)) {
      for (var j = 0; j < data.faq.length; j++) {
        var f = data.faq[j];
        if (f && typeof f === 'object' && (f.q || f.a)) {
          faq.push({ q: str(f.q), a: str(f.a) });
        }
      }
    }

    // Глоссарий: допускаем строки "Термин — определение" и объекты {term, def}
    var glossary = [];
    if (Array.isArray(data.glossary)) {
      for (var k = 0; k < data.glossary.length; k++) {
        var g = data.glossary[k];
        if (g && typeof g === 'object') {
          var term = str(g.term || g.name);
          var def = str(g.def || g.definition || g.value);
          if (term || def) glossary.push({ term: term, def: def });
        } else if (g !== null && g !== undefined && str(g).trim()) {
          var parts = str(g).split(/\s+[—–-]\s+|:\s+/);
          if (parts.length > 1) {
            glossary.push({ term: parts.shift().trim(), def: parts.join(' — ').trim() });
          } else {
            glossary.push({ term: str(g).trim(), def: '' });
          }
        }
      }
    }

    return {
      gameId: str(gameId),
      title: str(data.title) || str(gameId),
      goal: str(data.goal),
      howToPlay: strArray(data.howToPlay),
      payouts: payouts,
      tips: strArray(data.tips),
      faq: faq,
      glossary: glossary
    };
  }

  // Плоский текст записи для поиска (в нижнем регистре)
  function haystack(rec) {
    var parts = [rec.title, rec.goal];
    var i;
    for (i = 0; i < rec.howToPlay.length; i++) parts.push(rec.howToPlay[i]);
    for (i = 0; i < rec.payouts.length; i++) parts.push(rec.payouts[i].name, rec.payouts[i].value);
    for (i = 0; i < rec.tips.length; i++) parts.push(rec.tips[i]);
    for (i = 0; i < rec.faq.length; i++) parts.push(rec.faq[i].q, rec.faq[i].a);
    for (i = 0; i < rec.glossary.length; i++) parts.push(rec.glossary[i].term, rec.glossary[i].def);
    return parts.join('\n').toLowerCase();
  }

  /* ---------- Публичное API ---------- */

  // Регистрация (или перезапись) правил игры
  function register(gameId, data) {
    if (!gameId) throw new Error('NB.Rules.register: не указан gameId');
    var id = str(gameId);
    var rec = normalize(id, data);
    rec._hay = haystack(rec);
    rec._titleLow = rec.title.toLowerCase();
    if (!store[id]) order.push(id);
    store[id] = rec;
    return clone(publicView(rec));
  }

  // Публичное представление без служебных полей
  function publicView(rec) {
    return {
      gameId: rec.gameId,
      title: rec.title,
      goal: rec.goal,
      howToPlay: rec.howToPlay,
      payouts: rec.payouts,
      tips: rec.tips,
      faq: rec.faq,
      glossary: rec.glossary
    };
  }

  // Получить правила одной игры (копия) или null
  function get(gameId) {
    var rec = store[str(gameId)];
    return rec ? clone(publicView(rec)) : null;
  }

  // Все правила в порядке регистрации
  function getAll() {
    var out = [];
    for (var i = 0; i < order.length; i++) {
      out.push(clone(publicView(store[order[i]])));
    }
    return out;
  }

  // Поиск по названиям и тексту. Все слова запроса должны встретиться (И).
  // Результат: [{gameId, title, score, snippet}], по убыванию релевантности.
  function search(query) {
    var q = str(query).toLowerCase().trim();
    if (!q) return [];
    var words = q.split(/\s+/).filter(Boolean);
    var results = [];

    for (var i = 0; i < order.length; i++) {
      var rec = store[order[i]];
      var ok = true;
      var score = 0;

      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        if (rec._hay.indexOf(word) === -1) { ok = false; break; }
        if (rec._titleLow === word) score += 100;
        else if (rec._titleLow.indexOf(word) !== -1) score += 50;
        // Количество вхождений в тексте (с ограничением)
        var cnt = 0, pos = -1;
        while ((pos = rec._hay.indexOf(word, pos + 1)) !== -1 && cnt < 10) cnt++;
        score += cnt;
      }
      if (!ok) continue;

      results.push({
        gameId: rec.gameId,
        title: rec.title,
        score: score,
        snippet: makeSnippet(rec, words[0])
      });
    }

    results.sort(function (a, b) { return b.score - a.score; });
    return results;
  }

  // Короткий фрагмент текста вокруг первого найденного слова
  function makeSnippet(rec, word) {
    var chunks = [rec.goal].concat(rec.howToPlay, rec.tips);
    var i, j;
    for (i = 0; i < rec.faq.length; i++) chunks.push(rec.faq[i].q, rec.faq[i].a);
    for (i = 0; i < rec.glossary.length; i++) chunks.push(rec.glossary[i].term + ' — ' + rec.glossary[i].def);
    for (i = 0; i < rec.payouts.length; i++) chunks.push(rec.payouts[i].name + ' ' + rec.payouts[i].value);

    for (j = 0; j < chunks.length; j++) {
      var low = chunks[j].toLowerCase();
      var idx = low.indexOf(word);
      if (idx !== -1) {
        var start = Math.max(0, idx - 30);
        var end = Math.min(chunks[j].length, idx + word.length + 60);
        return (start > 0 ? '…' : '') + chunks[j].slice(start, end) + (end < chunks[j].length ? '…' : '');
      }
    }
    return rec.goal.slice(0, 90);
  }

  /* ---------- Рендер аккордеона ---------- */

  function injectStyles() {
    if (stylesInjected || !global.document) return;
    stylesInjected = true;
    var css = [
      '.nb-rules{display:flex;flex-direction:column;gap:10px;color:#e8e6f5;font-family:inherit}',
      '.nb-rules-title{font-size:20px;font-weight:700;color:#ffd24a;text-shadow:0 0 10px rgba(255,210,74,.35);margin:0 0 4px}',
      '.nb-acc-item{background:#171528;border:1px solid #3a2f6b;border-radius:12px;overflow:hidden}',
      '.nb-acc-item.open{border-color:#a259ff;box-shadow:0 0 12px rgba(162,89,255,.35)}',
      '.nb-acc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;',
      'padding:12px 14px;background:transparent;border:0;color:#fff;font-size:16px;font-weight:600;text-align:left;cursor:pointer;',
      '-webkit-tap-highlight-color:transparent}',
      '.nb-acc-arrow{flex:none;color:#ffd24a;transition:transform .2s}',
      '.nb-acc-item.open .nb-acc-arrow{transform:rotate(180deg)}',
      '.nb-acc-body{display:none;padding:0 14px 14px;font-size:15px;line-height:1.5;color:#cfcbe8}',
      '.nb-acc-item.open .nb-acc-body{display:block}',
      '.nb-acc-body ol,.nb-acc-body ul{margin:0;padding-left:20px}',
      '.nb-acc-body li{margin:4px 0}',
      '.nb-acc-body p{margin:0}',
      '.nb-pay-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #3a2f6b}',
      '.nb-pay-row:last-child{border-bottom:0}',
      '.nb-pay-val{color:#ffd24a;font-weight:700;white-space:nowrap}',
      '.nb-faq-q{font-weight:600;color:#fff;margin:8px 0 2px}',
      '.nb-faq-a{margin:0 0 6px}',
      '.nb-gl-term{color:#c9a0ff;font-weight:700}',
      '.nb-rules-empty{padding:16px;text-align:center;color:#9a95c0}'
    ].join('');
    var st = document.createElement('style');
    st.setAttribute('data-nb', 'rules');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // Построение секций аккордеона из записи
  function buildSections(rec) {
    var sections = [];
    var i, h;

    if (rec.goal) {
      sections.push({ id: 'goal', icon: '🎯', title: 'Цель игры', html: '<p>' + esc(rec.goal) + '</p>' });
    }
    if (rec.howToPlay.length) {
      h = '<ol>';
      for (i = 0; i < rec.howToPlay.length; i++) h += '<li>' + esc(rec.howToPlay[i]) + '</li>';
      sections.push({ id: 'how', icon: '📖', title: 'Как играть', html: h + '</ol>' });
    }
    if (rec.payouts.length) {
      h = '';
      for (i = 0; i < rec.payouts.length; i++) {
        h += '<div class="nb-pay-row"><span>' + esc(rec.payouts[i].name) +
             '</span><span class="nb-pay-val">' + esc(rec.payouts[i].value) + '</span></div>';
      }
      sections.push({ id: 'payouts', icon: '💰', title: 'Выплаты', html: h });
    }
    if (rec.tips.length) {
      h = '<ul>';
      for (i = 0; i < rec.tips.length; i++) h += '<li>' + esc(rec.tips[i]) + '</li>';
      sections.push({ id: 'tips', icon: '💡', title: 'Советы', html: h + '</ul>' });
    }
    if (rec.faq.length) {
      h = '';
      for (i = 0; i < rec.faq.length; i++) {
        h += '<div class="nb-faq-q">' + esc(rec.faq[i].q) + '</div><p class="nb-faq-a">' + esc(rec.faq[i].a) + '</p>';
      }
      sections.push({ id: 'faq', icon: '❓', title: 'Вопросы и ответы', html: h });
    }
    if (rec.glossary.length) {
      h = '<ul>';
      for (i = 0; i < rec.glossary.length; i++) {
        var g = rec.glossary[i];
        h += '<li><span class="nb-gl-term">' + esc(g.term) + '</span>' +
             (g.def ? ' — ' + esc(g.def) : '') + '</li>';
      }
      sections.push({ id: 'glossary', icon: '📚', title: 'Глоссарий', html: h + '</ul>' });
    }
    return sections;
  }

  // Рендер правил игры в контейнер. Возвращает {destroy()} для очистки обработчиков.
  function renderRules(gameId, container) {
    if (!container) throw new Error('NB.Rules.renderRules: не указан container');
    injectStyles();

    var rec = store[str(gameId)];
    container.innerHTML = '';

    var root = document.createElement('div');
    root.className = 'nb-rules';

    if (!rec) {
      root.innerHTML = '<div class="nb-rules-empty">Правила для этой игры пока не добавлены.</div>';
      container.appendChild(root);
      return { destroy: function () { container.innerHTML = ''; } };
    }

    var title = document.createElement('h2');
    title.className = 'nb-rules-title';
    title.textContent = rec.title;
    root.appendChild(title);

    var sections = buildSections(rec);
    var items = [];

    sections.forEach(function (sec, idx) {
      var item = document.createElement('div');
      item.className = 'nb-acc-item';

      var bodyId = 'nb-acc-' + rec.gameId + '-' + sec.id;

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'nb-acc-head';
      head.setAttribute('aria-expanded', 'false');
      head.setAttribute('aria-controls', bodyId);
      head.innerHTML = '<span>' + sec.icon + ' ' + esc(sec.title) + '</span><span class="nb-acc-arrow">▾</span>';

      var body = document.createElement('div');
      body.className = 'nb-acc-body';
      body.id = bodyId;
      body.setAttribute('role', 'region');
      body.innerHTML = sec.html;

      item.appendChild(head);
      item.appendChild(body);
      root.appendChild(item);
      items.push({ item: item, head: head });

      // Первая секция раскрыта по умолчанию
      if (idx === 0) setOpen(items[idx], true);
    });

    function setOpen(entry, open) {
      entry.item.classList.toggle('open', open);
      entry.head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // Делегирование: один обработчик на весь аккордеон
    function onClick(e) {
      var el = e.target;
      while (el && el !== root && !(el.classList && el.classList.contains('nb-acc-head'))) {
        el = el.parentNode;
      }
      if (!el || el === root) return;
      var current = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].head === el) { current = items[i]; break; }
      }
      if (!current) return;
      var willOpen = !current.item.classList.contains('open');
      // Одновременно открыта только одна секция
      for (var j = 0; j < items.length; j++) setOpen(items[j], false);
      setOpen(current, willOpen);
      if (global.NB && NB.Audio && typeof NB.Audio.play === 'function') {
        try { NB.Audio.play('click'); } catch (err) { /* звук не критичен */ }
      }
    }

    root.addEventListener('click', onClick);
    container.appendChild(root);

    return {
      destroy: function () {
        root.removeEventListener('click', onClick);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* ---------- Экспорт модуля ---------- */

  NB.Rules = {
    register: register,
    get: get,
    getAll: getAll,
    search: search,
    renderRules: renderRules
  };

})(typeof window !== 'undefined' ? window : this);