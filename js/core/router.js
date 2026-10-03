/* ==========================================================================
   NaebBet — js/core/router.js
   Модуль NB.Router: экраны, переходы, стек истории, кнопка «Назад» Android,
   подсветка нижней навигации, событие screen:change.
   ========================================================================== */
(function () {
  'use strict';

  var NB = (window.NB = window.NB || {});

  // ------------------------------------------------------------------
  // Константы и состояние
  // ------------------------------------------------------------------
  var HOME_ID = 'lobby';              // экран по умолчанию
  var ANIM_MS = 220;                 // длительность анимации перехода
  var EXIT_WINDOW_MS = 2000;         // окно для «двойного Назад» (выход)
  var STYLE_ID = 'nb-router-style';

  var screens = {};                  // screenId -> определение экрана
  var stack = [];                    // стек истории: {id, params, scroll}
  var pos = -1;                      // текущая позиция в стеке
  var current = null;                // {entry, def, wrapper}
  var container = null;              // DOM-контейнер экранов
  var pendingOld = [];               // уходящие обёртки, ещё в анимации
  var historyReady = false;          // инициализирована ли работа с history
  var exitArmed = false;             // нажат «Назад» на корневом экране
  var exitTimer = null;
  var skipBackEvent = false;         // программный back() не спрашивает перехватчиков
  var navBound = false;
  var domQueue = [];                 // переходы, запрошенные до готовности DOM

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------

  // Безопасная отправка события (NB.Events может быть ещё не загружен)
  function emit(name, data) {
    try {
      if (NB.Events && typeof NB.Events.emit === 'function') {
        NB.Events.emit(name, data);
      }
    } catch (e) {
      console.error('[Router] Ошибка в обработчике события ' + name, e);
    }
  }

  function toast(text, type) {
    try {
      if (NB.UI && typeof NB.UI.toast === 'function') NB.UI.toast(text, type || 'info');
    } catch (e) { /* игнорируем */ }
  }

  function playSound(name) {
    try {
      if (NB.Audio && typeof NB.Audio.play === 'function') NB.Audio.play(name);
    } catch (e) { /* игнорируем */ }
  }

  // Поверхностное сравнение параметров
  function shallowEqual(a, b) {
    a = a || {};
    b = b || {};
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (a[ka[i]] !== b[ka[i]]) return false;
    }
    return true;
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  // Минимальные стили роутера (внедряются один раз)
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.nb-screen-host{position:relative;overflow-x:hidden;}' +
      '.nb-view{width:100%;min-height:100%;box-sizing:border-box;}' +
      '.nb-screen-error{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:14px;padding:32px 20px;text-align:center;color:#e8e0ff;min-height:60vh;}' +
      '.nb-screen-error .nb-err-icon{font-size:56px;}' +
      '.nb-screen-error .nb-err-text{font-size:16px;opacity:.85;}' +
      '.nb-screen-error button{min-height:48px;min-width:160px;padding:0 24px;border-radius:14px;' +
      'border:2px solid #ffd54a;background:#1b1233;color:#ffd54a;font-size:16px;font-weight:700;' +
      'box-shadow:0 0 14px rgba(255,213,74,.35);}';
    document.head.appendChild(st);
  }

  // Поиск (или создание) контейнера для экранов
  function getContainer() {
    if (container && document.body.contains(container)) return container;
    var sels = ['#screen', '#nb-screen', '#screen-container', '#app-screen', 'main', '#app'];
    var el = null;
    for (var i = 0; i < sels.length && !el; i++) el = document.querySelector(sels[i]);
    if (!el) {
      el = document.createElement('div');
      el.id = 'nb-screen';
      document.body.appendChild(el);
    }
    container = el;
    injectStyle();
    container.classList.add('nb-screen-host');
    return container;
  }

  // ------------------------------------------------------------------
  // Подсветка нижней навигации
  // ------------------------------------------------------------------
  var NAV_ITEM_SEL = '.nb-nav [data-screen], #nb-nav [data-screen], [data-nav] [data-screen]';
  var NAV_ROOT_SEL = '.nb-nav, #nb-nav, [data-nav]';

  function highlightNav(tab) {
    var items = document.querySelectorAll(NAV_ITEM_SEL);
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-screen') === tab;
      items[i].classList.toggle('active', on);
      if (on) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
  }

  function bindNav() {
    if (navBound) return;
    navBound = true;
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // Кнопка «Назад» в интерфейсе
      var backBtn = t.closest('[data-nav-back]');
      if (backBtn) {
        e.preventDefault();
        playSound('click');
        Router.back();
        return;
      }

      // Вкладки нижней навигации
      var item = t.closest('[data-screen]');
      if (!item || !item.closest(NAV_ROOT_SEL)) return;
      e.preventDefault();
      var id = item.getAttribute('data-screen');
      if (!id) return;
      playSound('click');
      Router.go(id);
    });
  }

  // ------------------------------------------------------------------
  // Анимация переходов
  // ------------------------------------------------------------------

  // Мгновенно убрать все зависшие уходящие экраны
  function flushPending() {
    while (pendingOld.length) {
      var p = pendingOld.pop();
      try { if (p.anim) p.anim.cancel(); } catch (e) { /* игнорируем */ }
      if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
    }
  }

  function animateIn(el, direction) {
    if (direction === 'none' || reducedMotion() || typeof el.animate !== 'function') return;
    var from = direction === 'back' ? -36 : 36;
    try {
      el.animate(
        [
          { opacity: 0, transform: 'translateX(' + from + 'px)' },
          { opacity: 1, transform: 'translateX(0)' }
        ],
        { duration: ANIM_MS, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    } catch (e) { /* игнорируем */ }
  }

  function animateOut(el, direction) {
    var rec = { el: el, anim: null };
    pendingOld.push(rec);

    function done() {
      var i = pendingOld.indexOf(rec);
      if (i >= 0) pendingOld.splice(i, 1);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    // Уходящий экран больше не интерактивен и не влияет на раскладку
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.pointerEvents = 'none';

    if (direction === 'none' || reducedMotion() || typeof el.animate !== 'function') {
      done();
      return;
    }
    var to = direction === 'back' ? 36 : -36;
    try {
      rec.anim = el.animate(
        [
          { opacity: 1, transform: 'translateX(0)' },
          { opacity: 0, transform: 'translateX(' + to + 'px)' }
        ],
        { duration: ANIM_MS, easing: 'ease-in', fill: 'forwards' }
      );
      rec.anim.onfinish = done;
      rec.anim.oncancel = done;
    } catch (e) {
      done();
    }
  }

  // ------------------------------------------------------------------
  // Экран-ошибка (если mount упал или игра не найдена)
  // ------------------------------------------------------------------
  function showError(wrapper, message) {
    wrapper.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'nb-screen-error';

    var icon = document.createElement('div');
    icon.className = 'nb-err-icon';
    icon.textContent = '⚠️';

    var text = document.createElement('div');
    text.className = 'nb-err-text';
    text.textContent = message;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'На главную';
    btn.addEventListener('click', function () {
      playSound('click');
      if (screens[HOME_ID]) Router.go(HOME_ID);
    });

    box.appendChild(icon);
    box.appendChild(text);
    box.appendChild(btn);
    wrapper.appendChild(box);
  }

  // ------------------------------------------------------------------
  // Отрисовка записи стека
  // ------------------------------------------------------------------
  function render(entry, direction) {
    var def = screens[entry.id];
    var cont = getContainer();
    var prev = current;

    flushPending();

    // Запоминаем позицию прокрутки и размонтируем предыдущий экран
    if (prev) {
      prev.entry.scroll = { w: window.pageYOffset || 0, c: cont.scrollTop || 0 };
      try {
        if (prev.def && typeof prev.def.unmount === 'function') prev.def.unmount();
      } catch (e) {
        console.error('[Router] Ошибка unmount экрана "' + prev.entry.id + '"', e);
      }
    }

    // Новая обёртка экрана
    var wrapper = document.createElement('div');
    wrapper.className = 'nb-view';
    wrapper.setAttribute('data-screen-id', entry.id);

    if (prev && prev.wrapper) animateOut(prev.wrapper, direction);
    cont.appendChild(wrapper);

    // Монтирование
    current = { entry: entry, def: def, wrapper: wrapper };
    try {
      def.mount(wrapper, entry.params || {});
    } catch (e) {
      console.error('[Router] Ошибка mount экрана "' + entry.id + '"', e);
      showError(wrapper, 'Не удалось открыть экран. Попробуйте ещё раз.');
      toast('Ошибка открытия экрана', 'error');
    }

    animateIn(wrapper, direction);

    // Прокрутка: при возврате восстанавливаем, иначе вверх
    var sc = direction === 'back' && entry.scroll ? entry.scroll : { w: 0, c: 0 };
    cont.scrollTop = sc.c;
    try { window.scrollTo(0, sc.w); } catch (e) { /* игнорируем */ }

    // Подсветка вкладки и служебные атрибуты
    var tab = def.tab || entry.id;
    highlightNav(tab);
    document.body.setAttribute('data-screen', entry.id);

    emit('screen:change', {
      id: entry.id,
      params: entry.params || {},
      prevId: prev ? prev.entry.id : null,
      prevParams: prev ? prev.entry.params || {} : null,
      direction: direction,
      tab: tab
    });
  }

  // ------------------------------------------------------------------
  // Работа с history (кнопка «Назад» Android)
  // ------------------------------------------------------------------
  function safeReplaceState(state) {
    try { history.replaceState(state, ''); } catch (e) { /* игнорируем */ }
  }

  function safePushState(state) {
    try { history.pushState(state, ''); } catch (e) { /* игнорируем */ }
  }

  // Первая запись: «страж» (idx -1) + запись корневого экрана (idx 0).
  // Нажатие «Назад» на корне попадает на стража — это позволяет
  // перехватить выход и потребовать повторного нажатия.
  function initHistory() {
    if (historyReady) return;
    historyReady = true;
    safeReplaceState({ nb: 1, idx: -1 });
    safePushState({ nb: 1, idx: 0 });
    window.addEventListener('popstate', onPopState);
  }

  function restoreHistoryEntry() {
    safePushState({ nb: 1, idx: pos });
  }

  function onPopState(ev) {
    if (!historyReady) return;
    var st = ev.state;
    var idx = st && st.nb === 1 && typeof st.idx === 'number' ? st.idx : -1;

    if (idx === pos) return; // наше собственное состояние

    var internal = skipBackEvent;
    skipBackEvent = false;

    var inRange = idx >= 0 && idx < stack.length;
    var direction = idx < pos ? 'back' : 'forward';

    // Даём шанс модалкам и др. перехватить «Назад»
    if (!internal && direction === 'back') {
      var bev = { handled: false, from: current ? current.entry.id : null };
      emit('router:back', bev);
      if (bev.handled) {
        restoreHistoryEntry();
        return;
      }
    }

    if (inRange) {
      pos = idx;
      render(stack[pos], direction);
      return;
    }

    // Страж: пользователь нажал «Назад» на корневом экране
    if (exitArmed) {
      exitArmed = false;
      clearTimeout(exitTimer);
      // Второе нажатие — выходим; если выйти нельзя, восстанавливаем состояние
      try { history.back(); } catch (e) { /* игнорируем */ }
      setTimeout(restoreHistoryEntry, 500);
    } else {
      exitArmed = true;
      toast('Нажмите «Назад» ещё раз для выхода', 'info');
      restoreHistoryEntry();
      clearTimeout(exitTimer);
      exitTimer = setTimeout(function () { exitArmed = false; }, EXIT_WINDOW_MS);
    }
  }

  // ------------------------------------------------------------------
  // Публичный API
  // ------------------------------------------------------------------
  var Router = {
    /**
     * Регистрация экрана.
     * def: {mount(container, params), unmount(), tab?}
     * tab — id вкладки нижней навигации, которую подсвечивать (по умолчанию id экрана).
     */
    register: function (screenId, def) {
      if (!screenId || typeof screenId !== 'string') {
        throw new Error('Router.register: нужен строковый screenId');
      }
      if (!def || typeof def.mount !== 'function') {
        throw new Error('Router.register: у экрана "' + screenId + '" нет метода mount');
      }
      screens[screenId] = def;
    },

    /** Переход на экран. Возвращает true, если переход выполнен. */
    go: function (screenId, params) {
      if (document.readyState === 'loading') {
        domQueue.push([screenId, params]);
        return true;
      }
      if (!screens[screenId]) {
        console.error('[Router] Экран не зарегистрирован: ' + screenId);
        toast('Экран недоступен', 'error');
        return false;
      }
      bindNav();

      // Повторный переход на тот же экран с теми же параметрами — игнорируем
      if (current && current.entry.id === screenId && shallowEqual(current.entry.params, params)) {
        return false;
      }

      // Обрезаем «вперёд» и добавляем запись
      stack.length = pos + 1;
      var entry = { id: screenId, params: params || {}, scroll: null };
      var direction = current ? 'forward' : 'none';
      stack.push(entry);
      pos++;

      if (pos === 0) initHistory();
      else safePushState({ nb: 1, idx: pos });

      render(entry, direction);
      return true;
    },

    /** Возврат на предыдущий экран. Возвращает true, если возврат выполнен. */
    back: function () {
      if (pos > 0) {
        if (historyReady) {
          skipBackEvent = true;
          try {
            history.back();
            return true;
          } catch (e) {
            skipBackEvent = false;
          }
        }
        pos--;
        render(stack[pos], 'back');
        return true;
      }
      // Стек пуст — ведём на главную, если мы не на ней
      if (current && current.entry.id !== HOME_ID && screens[HOME_ID]) {
        return Router.go(HOME_ID);
      }
      return false;
    },

    /** Можно ли вернуться назад. */
    canGoBack: function () {
      return pos > 0 || !!(current && current.entry.id !== HOME_ID && screens[HOME_ID]);
    },

    /** Текущий экран: {id, params} или null. */
    getCurrent: function () {
      if (!current) return null;
      return { id: current.entry.id, params: current.entry.params || {} };
    },

    /** Зарегистрирован ли экран. */
    has: function (screenId) {
      return !!screens[screenId];
    },

    /** Явно задать контейнер экранов (необязательно). */
    setContainer: function (el) {
      if (el && el.nodeType === 1) {
        container = el;
        injectStyle();
        container.classList.add('nb-screen-host');
      }
    },

    /** Запуск приложения: открыть стартовый экран (по умолчанию "home"). */
    start: function (screenId, params) {
      if (current) return false;
      return Router.go(screenId || HOME_ID, params);
    }
  };

  // ------------------------------------------------------------------
  // Встроенный экран "game": открывает игру из NB.Games по params.id
  // ------------------------------------------------------------------
  (function registerGameScreen() {
    var activeGame = null;

    Router.register('game', {
      tab: 'games', // в нижней навигации подсвечивается вкладка «Игры»

      mount: function (cont, params) {
        var id = params && params.id;
        var game = NB.Games && typeof NB.Games.get === 'function' ? NB.Games.get(id) : null;
        if (!game) {
          showError(cont, 'Игра не найдена: ' + (id || '—'));
          return;
        }
        activeGame = game;
        game.mount(cont);
      },

      unmount: function () {
        var g = activeGame;
        activeGame = null; // обнуляем заранее, чтобы unmount не вызвался дважды
        if (g && typeof g.unmount === 'function') {
          try {
            g.unmount();
          } catch (e) {
            console.error('[Router] Ошибка unmount игры "' + g.id + '"', e);
          }
        }
      }
    });
  })();

  // ------------------------------------------------------------------
  // Инициализация DOM
  // ------------------------------------------------------------------
  function onReady() {
    bindNav();
    // Выполняем переходы, запрошенные до готовности DOM
    var q = domQueue.splice(0, domQueue.length);
    for (var i = 0; i < q.length; i++) Router.go(q[i][0], q[i][1]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // Страховка: если никто не открыл экран, открываем "home" после полной загрузки
  window.addEventListener('load', function () {
    if (!current && screens[HOME_ID]) Router.go(HOME_ID);
  });

  NB.Router = Router;
})();