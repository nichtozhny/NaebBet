/* js/screens/settings.js — экран «Настройки» NaebBet */
(function () {
  'use strict';

  var NB = window.NB = window.NB || {};

  var STORAGE_KEY = 'nb_settings';
  var APP_VERSION = '1.0.0';

  // Значения по умолчанию
  var DEFAULTS = {
    muted: false,
    volume: 0.7,
    vibration: true,
    fastAnim: false,
    confirmBig: true,
    confirmThreshold: 1000
  };

  var THRESHOLD_PRESETS = [500, 1000, 5000, 10000, 50000];
  var THRESHOLD_MIN = 100;
  var THRESHOLD_MAX = 1000000000;

  var state = null;       // текущие настройки
  var cleanups = [];      // функции очистки обработчиков экрана
  var timers = [];        // таймеры экрана
  var rootEl = null;      // корневой элемент экрана
  var refs = {};          // ссылки на элементы

  /* ---------- Работа с настройками (общий модуль NB.Settings) ---------- */

  function loadSettings() {
    var saved = null;
    try {
      saved = NB.Storage && NB.Storage.get ? NB.Storage.get(STORAGE_KEY, null) : null;
    } catch (e) { saved = null; }
    var res = {};
    var k;
    for (k in DEFAULTS) { res[k] = DEFAULTS[k]; }
    if (saved && typeof saved === 'object') {
      for (k in DEFAULTS) {
        if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) {
          res[k] = saved[k];
        }
      }
    }
    res.volume = clamp(Number(res.volume), 0, 1);
    res.confirmThreshold = clampInt(res.confirmThreshold, THRESHOLD_MIN, THRESHOLD_MAX);
    return res;
  }

  function saveSettings() {
    try {
      NB.Storage.set(STORAGE_KEY, state);
    } catch (e) {
      if (NB.UI && NB.UI.toast) { NB.UI.toast('Не удалось сохранить настройки', 'error'); }
    }
  }

  function clamp(v, a, b) {
    if (!isFinite(v)) { return a; }
    return Math.min(b, Math.max(a, v));
  }

  function clampInt(v, a, b) {
    v = Math.round(Number(v));
    return clamp(v, a, b);
  }

  // Применяет настройки к остальной системе
  function applyAll() {
    if (!state) { state = loadSettings(); }
    try {
      if (NB.Audio) {
        NB.Audio.setVolume(state.volume);
        NB.Audio.setMuted(state.muted);
      }
    } catch (e) { /* аудио может быть ещё не готово */ }
    var root = document.documentElement;
    if (root && root.classList) {
      root.classList.toggle('nb-fast-anim', !!state.fastAnim);
      root.style.setProperty('--nb-anim-scale', state.fastAnim ? '0.4' : '1');
    }
  }

  // Вибрация (с учётом настройки и поддержки устройством)
  function vibrate(pattern) {
    if (!state) { state = loadSettings(); }
    if (!state.vibration) { return false; }
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') { return false; }
    try { return navigator.vibrate(pattern || 30); } catch (e) { return false; }
  }

  function setSetting(key, val) {
    if (!(key in DEFAULTS)) { return; }
    if (!state) { state = loadSettings(); }
    state[key] = val;
    saveSettings();
    applyAll();
    if (NB.Events) { NB.Events.emit('settings:change', { key: key, value: val }); }
  }

  NB.Settings = {
    get: function (key) {
      if (!state) { state = loadSettings(); }
      return key === undefined ? JSON.parse(JSON.stringify(state)) : state[key];
    },
    set: setSetting,
    apply: applyAll,
    vibrate: vibrate,
    // Длительность анимации с учётом режима «быстрые анимации»
    animMs: function (ms) {
      if (!state) { state = loadSettings(); }
      return state.fastAnim ? Math.round(ms * 0.4) : ms;
    },
    // Нужно ли подтверждение для данной ставки
    needsConfirm: function (amount) {
      if (!state) { state = loadSettings(); }
      return !!state.confirmBig && Number(amount) >= state.confirmThreshold;
    },
    getThreshold: function () {
      if (!state) { state = loadSettings(); }
      return state.confirmThreshold;
    }
  };

  /* ---------- Стили ---------- */

  function injectStyle() {
    if (document.getElementById('nb-settings-style')) { return; }
    var css = [
      '.nb-fast-anim *,.nb-fast-anim *::before,.nb-fast-anim *::after{transition-duration:.08s !important;animation-duration:.18s !important;}',
      '.nbs{min-height:100%;padding:12px 14px calc(28px + env(safe-area-inset-bottom,0px));color:#ece8ff;background:#0d0b1a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-tap-highlight-color:transparent;box-sizing:border-box;}',
      '.nbs *{box-sizing:border-box;}',
      '.nbs-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;}',
      '.nbs-back{min-width:44px;min-height:44px;border-radius:12px;border:1px solid #6d3fc4;background:#1a1530;color:#ffd34d;font-size:20px;cursor:pointer;}',
      '.nbs-title{font-size:22px;font-weight:800;margin:0;color:#ffd34d;text-shadow:0 0 12px rgba(255,211,77,.45);}',
      '.nbs-card{background:linear-gradient(160deg,#17122b,#120f24);border:1px solid #3b2a73;border-radius:16px;padding:14px;margin-bottom:14px;box-shadow:0 0 18px rgba(168,85,247,.12);}',
      '.nbs-card h2{margin:0 0 10px;font-size:16px;color:#c79bff;text-transform:uppercase;letter-spacing:.06em;}',
      '.nbs-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:8px 0;border-top:1px solid rgba(124,77,255,.18);}',
      '.nbs-row:first-of-type{border-top:none;}',
      '.nbs-row.dis{opacity:.5;}',
      '.nbs-lbl{flex:1;min-width:0;}',
      '.nbs-lbl b{display:block;font-size:16px;font-weight:700;}',
      '.nbs-lbl span{display:block;font-size:13px;color:#a69cc9;margin-top:2px;line-height:1.3;}',
      '.nbs-sw{position:relative;flex:none;width:60px;min-height:44px;border:none;background:transparent;padding:0;cursor:pointer;}',
      '.nbs-sw::before{content:"";position:absolute;left:0;top:50%;width:56px;height:30px;margin-top:-15px;border-radius:15px;background:#2a2350;border:1px solid #4b3a8f;transition:background .2s,box-shadow .2s;}',
      '.nbs-sw::after{content:"";position:absolute;left:4px;top:50%;width:22px;height:22px;margin-top:-11px;border-radius:50%;background:#8f86b8;transition:transform .2s,background .2s;}',
      '.nbs-sw[aria-checked="true"]::before{background:#6d28d9;box-shadow:0 0 12px rgba(168,85,247,.7);}',
      '.nbs-sw[aria-checked="true"]::after{transform:translateX(26px);background:#ffd34d;}',
      '.nbs-sw:disabled{cursor:default;}',
      '.nbs-range{width:100%;min-height:44px;margin:0;accent-color:#a855f7;background:transparent;}',
      '.nbs-vol{display:flex;align-items:center;gap:10px;padding:6px 0 10px;}',
      '.nbs-vol output{min-width:46px;text-align:right;font-weight:700;color:#ffd34d;}',
      '.nbs-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;padding:10px 14px;margin-top:10px;border-radius:14px;border:1px solid #7c3aed;background:#1f1840;color:#f1ecff;font-size:16px;font-weight:700;cursor:pointer;text-align:center;}',
      '.nbs-btn:active{transform:scale(.98);background:#2b2060;}',
      '.nbs-btn.gold{background:linear-gradient(180deg,#ffd34d,#e0a800);color:#1a1200;border-color:#ffd34d;box-shadow:0 0 14px rgba(255,211,77,.4);}',
      '.nbs-btn.danger{background:#3a0f1f;border-color:#ff3b6b;color:#ff8aa6;}',
      '.nbs-btns{display:flex;gap:10px;}',
      '.nbs-btns .nbs-btn{flex:1;}',
      '.nbs-chips{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0;}',
      '.nbs-chip{min-width:44px;min-height:44px;padding:8px 12px;border-radius:12px;border:1px solid #4b3a8f;background:#1a1530;color:#d9ceff;font-size:15px;font-weight:700;cursor:pointer;}',
      '.nbs-chip.on{background:#6d28d9;border-color:#a855f7;color:#ffd34d;box-shadow:0 0 10px rgba(168,85,247,.6);}',
      '.nbs-chip:disabled{cursor:default;}',
      '.nbs-num{width:100%;min-height:48px;padding:8px 12px;border-radius:12px;border:1px solid #4b3a8f;background:#0f0c20;color:#ffd34d;font-size:18px;font-weight:700;}',
      '.nbs-ta{width:100%;min-height:120px;margin-top:10px;padding:10px;border-radius:12px;border:1px solid #4b3a8f;background:#0f0c20;color:#d9ceff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;resize:vertical;}',
      '.nbs-note{font-size:13px;color:#a69cc9;line-height:1.45;margin:6px 0 0;}',
      '.nbs-about p{margin:8px 0;font-size:14px;line-height:1.5;color:#cfc6ee;}',
      '.nbs-warn{border:1px solid #ffd34d;border-radius:12px;padding:10px 12px;background:rgba(255,211,77,.08);color:#ffe9a3;font-size:14px;line-height:1.45;margin:8px 0;}',
      '.nbs-ver{text-align:center;color:#7d739f;font-size:12px;margin-top:6px;}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'nb-settings-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- Утилиты DOM ---------- */

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    var k;
    if (attrs) {
      for (k in attrs) {
        if (k === 'class') { el.className = attrs[k]; }
        else if (k === 'text') { el.textContent = attrs[k]; }
        else { el.setAttribute(k, attrs[k]); }
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (children[i]) { el.appendChild(children[i]); }
      }
    }
    return el;
  }

  // Навешивает обработчик и запоминает его для очистки
  function listen(el, type, fn) {
    el.addEventListener(type, fn);
    cleanups.push(function () { el.removeEventListener(type, fn); });
  }

  function later(fn, ms) {
    var id = setTimeout(function () {
      var i = timers.indexOf(id);
      if (i >= 0) { timers.splice(i, 1); }
      fn();
    }, ms);
    timers.push(id);
    return id;
  }

  function toast(text, type) {
    if (NB.UI && NB.UI.toast) { NB.UI.toast(text, type || 'info'); }
  }

  function playSound(name) {
    try { if (NB.Audio) { NB.Audio.play(name); } } catch (e) { /* игнор */ }
  }

  function askConfirm(text) {
    if (NB.UI && NB.UI.confirm) { return NB.UI.confirm(text); }
    return Promise.resolve(window.confirm(text));
  }

  function fmt(n) {
    return NB.UI && NB.UI.formatMoney ? NB.UI.formatMoney(n) : String(n);
  }

  function makeSwitch(label, desc, key, onChange) {
    var btn = h('button', {
      'class': 'nbs-sw',
      type: 'button',
      role: 'switch',
      'aria-label': label,
      'aria-checked': state[key] ? 'true' : 'false'
    });
    listen(btn, 'click', function () {
      var next = !state[key];
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      setSetting(key, next);
      if (onChange) { onChange(next); }
    });
    var row = h('div', { 'class': 'nbs-row' }, [
      h('div', { 'class': 'nbs-lbl' }, [
        h('b', { text: label }),
        desc ? h('span', { text: desc }) : null
      ]),
      btn
    ]);
    return { row: row, btn: btn };
  }

  function makeButton(text, cls, onClick) {
    var b = h('button', { 'class': 'nbs-btn' + (cls ? ' ' + cls : ''), type: 'button', text: text });
    listen(b, 'click', onClick);
    return b;
  }

  /* ---------- Секции ---------- */

  function buildSound() {
    var sw = makeSwitch('Звук', 'Эффекты игр и интерфейса', 'muted', function (isMuted) {
      if (!isMuted) { playSound('click'); }
    });
    // Переключатель «Звук» инвертирован: включено = не заглушено
    sw.btn.setAttribute('aria-checked', state.muted ? 'false' : 'true');
    var swBtn = sw.btn;
    var clone = swBtn.cloneNode(true);
    swBtn.parentNode.replaceChild(clone, swBtn);
    // Старый обработчик остался на удалённом узле — навешиваем корректный
    listen(clone, 'click', function () {
      var soundOn = clone.getAttribute('aria-checked') !== 'true';
      clone.setAttribute('aria-checked', soundOn ? 'true' : 'false');
      setSetting('muted', !soundOn);
      if (soundOn) { playSound('click'); }
      refs.volume.disabled = !soundOn;
      refs.volRow.style.opacity = soundOn ? '1' : '.5';
    });

    var vol = h('input', {
      'class': 'nbs-range',
      type: 'range', min: '0', max: '100', step: '1',
      'aria-label': 'Громкость',
      value: String(Math.round(state.volume * 100))
    });
    var out = h('output', { text: Math.round(state.volume * 100) + '%' });
    refs.volume = vol;
    vol.disabled = state.muted;
    var lastTick = 0;
    listen(vol, 'input', function () {
      var v = clamp(Number(vol.value) / 100, 0, 1);
      out.textContent = Math.round(v * 100) + '%';
      setSetting('volume', v);
      var now = Date.now();
      if (now - lastTick > 120) { lastTick = now; playSound('tick'); }
    });
    listen(vol, 'change', function () { playSound('coin'); });

    var volRow = h('div', { 'class': 'nbs-vol' }, [
      h('span', { text: '🔈' }), vol, out, h('span', { text: '🔊' })
    ]);
    volRow.style.opacity = state.muted ? '.5' : '1';
    refs.volRow = volRow;

    var test = makeButton('🎵 Проверить звук', '', function () { playSound('win'); });

    return h('section', { 'class': 'nbs-card' }, [
      h('h2', { text: '🔊 Звук' }),
      sw.row,
      h('div', { 'class': 'nbs-lbl' }, [h('b', { text: 'Громкость' })]),
      volRow,
      test
    ]);
  }

  function buildFeedback() {
    var supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    var sw = makeSwitch('Вибрация', supported
      ? 'Отклик при выигрыше и важных действиях'
      : 'Это устройство или браузер не поддерживает вибрацию', 'vibration', function (on) {
      if (on) { vibrate(40); }
    });
    if (!supported) {
      sw.btn.disabled = true;
      sw.row.classList.add('dis');
    }

    var anim = makeSwitch('Быстрые анимации', 'Ускоряет вращение, переходы и счётчики', 'fastAnim', function () {
      playSound('click');
    });

    var card = h('section', { 'class': 'nbs-card' }, [
      h('h2', { text: '🎛️ Отклик и анимации' }),
      sw.row
    ]);
    if (supported) {
      card.appendChild(makeButton('📳 Проверить вибрацию', '', function () {
        if (!state.vibration) { toast('Сначала включите вибрацию', 'error'); return; }
        vibrate([60, 40, 60]);
      }));
    }
    card.appendChild(anim.row);
    return card;
  }

  function buildBets() {
    var sw = makeSwitch('Подтверждать крупные ставки', 'Спрашивать перед ставкой не меньше порога', 'confirmBig', function () {
      refreshThreshold();
      playSound('click');
    });

    var chipsWrap = h('div', { 'class': 'nbs-chips' });
    var chipBtns = [];
    THRESHOLD_PRESETS.forEach(function (p) {
      var c = h('button', { 'class': 'nbs-chip', type: 'button', text: fmt(p) });
      listen(c, 'click', function () {
        if (!state.confirmBig) { return; }
        setSetting('confirmThreshold', p);
        input.value = String(p);
        refreshThreshold();
        playSound('tick');
      });
      chipBtns.push({ el: c, val: p });
      chipsWrap.appendChild(c);
    });

    var input = h('input', {
      'class': 'nbs-num',
      type: 'number', inputmode: 'numeric', pattern: '[0-9]*',
      min: String(THRESHOLD_MIN), max: String(THRESHOLD_MAX), step: '100',
      'aria-label': 'Порог подтверждения',
      value: String(state.confirmThreshold)
    });
    listen(input, 'change', function () {
      var v = clampInt(input.value, THRESHOLD_MIN, THRESHOLD_MAX);
      input.value = String(v);
      setSetting('confirmThreshold', v);
      refreshThreshold();
    });

    var note = h('p', { 'class': 'nbs-note' });
    var body = h('div', {}, [
      h('div', { 'class': 'nbs-lbl' }, [h('b', { text: 'Порог (NB-монет)' })]),
      chipsWrap, input, note
    ]);

    function refreshThreshold() {
      var on = !!state.confirmBig;
      body.style.opacity = on ? '1' : '.5';
      input.disabled = !on;
      chipBtns.forEach(function (c) {
        c.el.disabled = !on;
        c.el.classList.toggle('on', c.val === state.confirmThreshold);
      });
      note.textContent = on
        ? 'Ставки от ' + fmt(state.confirmThreshold) + ' NB потребуют подтверждения.'
        : 'Подтверждение отключено — ставки принимаются сразу.';
    }
    refreshThreshold();

    return h('section', { 'class': 'nbs-card' }, [
      h('h2', { text: '🛡️ Крупные ставки' }),
      sw.row,
      body
    ]);
  }

  /* ---------- Резервная копия ---------- */

  function getExportText() {
    var data = NB.Storage.exportAll();
    if (typeof data !== 'string') { data = JSON.stringify(data, null, 2); }
    return data;
  }

  function exportToFile() {
    try {
      var text = getExportText();
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var d = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var name = 'naebbet-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
        '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      later(function () {
        if (a.parentNode) { a.parentNode.removeChild(a); }
        URL.revokeObjectURL(url);
      }, 1500);
      playSound('coin');
      toast('Резервная копия сохранена', 'success');
    } catch (e) {
      playSound('error');
      toast('Не удалось создать копию', 'error');
    }
  }

  function showExportText() {
    try {
      refs.ta.value = getExportText();
      refs.ta.focus();
      refs.ta.select();
      toast('Копия показана в поле ниже', 'info');
    } catch (e) {
      playSound('error');
      toast('Не удалось создать копию', 'error');
    }
  }

  function copyText() {
    var text = refs.ta.value;
    if (!text) { showExportText(); text = refs.ta.value; }
    if (!text) { return; }
    function fallback() {
      try {
        refs.ta.focus();
        refs.ta.select();
        var ok = document.execCommand('copy');
        toast(ok ? 'Скопировано' : 'Выделите текст и скопируйте вручную', ok ? 'success' : 'error');
      } catch (e) {
        toast('Выделите текст и скопируйте вручную', 'error');
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('Скопировано', 'success');
      }, fallback);
    } else {
      fallback();
    }
  }

  function reloadSoon() {
    later(function () { window.location.reload(); }, 900);
  }

  // Импорт из строки JSON
  function doImport(text) {
    text = (text || '').trim();
    if (!text) {
      playSound('error');
      toast('Вставьте резервную копию или выберите файл', 'error');
      return;
    }
    try { JSON.parse(text); } catch (e) {
      playSound('error');
      toast('Это не похоже на корректную копию (ошибка JSON)', 'error');
      return;
    }
    askConfirm('Импорт заменит текущие данные (баланс, статистику, настройки). Продолжить?').then(function (ok) {
      if (!ok) { return; }
      var result;
      try {
        result = NB.Storage.importAll(text);
      } catch (e) {
        playSound('error');
        toast('Импорт не удался: ' + (e && e.message ? e.message : 'неверный формат'), 'error');
        return;
      }
      if (result === false) {
        playSound('error');
        toast('Импорт не удался: неверный формат данных', 'error');
        return;
      }
      state = loadSettings();
      applyAll();
      playSound('bigwin');
      toast('Данные восстановлены. Перезапуск…', 'success');
      reloadSoon();
    });
  }

  function importFromFile(file) {
    if (!file) { return; }
    if (file.size > 20 * 1024 * 1024) {
      playSound('error');
      toast('Файл слишком большой', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { doImport(String(reader.result || '')); };
    reader.onerror = function () {
      playSound('error');
      toast('Не удалось прочитать файл', 'error');
    };
    reader.readAsText(file);
  }

  function buildBackup() {
    var fileInput = h('input', { type: 'file', accept: '.json,application/json,text/plain' });
    fileInput.style.display = 'none';
    listen(fileInput, 'change', function () {
      var f = fileInput.files && fileInput.files[0];
      importFromFile(f);
      fileInput.value = '';
    });

    var ta = h('textarea', {
      'class': 'nbs-ta',
      placeholder: 'Здесь появится копия для экспорта, либо вставьте сюда копию для импорта…',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      'aria-label': 'Текст резервной копии'
    });
    refs.ta = ta;

    return h('section', { 'class': 'nbs-card' }, [
      h('h2', { text: '💾 Резервная копия' }),
      h('p', { 'class': 'nbs-note', text: 'Сохраните прогресс в файл или текст, чтобы перенести его на другое устройство или восстановить после сброса.' }),
      makeButton('⬇️ Экспорт в файл', 'gold', exportToFile),
      makeButton('📂 Импорт из файла', '', function () { fileInput.click(); }),
      fileInput,
      ta,
      h('div', { 'class': 'nbs-btns' }, [
        makeButton('📋 Показать', '', showExportText),
        makeButton('📄 Копировать', '', copyText)
      ]),
      makeButton('⬆️ Импорт из текста', '', function () { doImport(ta.value); })
    ]);
  }

  /* ---------- Сброс данных ---------- */

  function resetFlow() {
    askConfirm('Удалить ВСЕ данные: баланс, статистику, уровень, достижения и настройки?').then(function (first) {
      if (!first) { return; }
      return askConfirm('Это действие необратимо! Баланс вернётся к 10 000 NB. Точно сбросить всё?').then(function (second) {
        if (!second) { toast('Сброс отменён', 'info'); return; }
        try {
          NB.Storage.resetAll();
        } catch (e) {
          playSound('error');
          toast('Не удалось сбросить данные', 'error');
          return;
        }
        state = loadSettings();
        applyAll();
        playSound('lose');
        toast('Данные сброшены. Перезапуск…', 'success');
        reloadSoon();
      });
    });
  }

  function buildReset() {
    return h('section', { 'class': 'nbs-card' }, [
      h('h2', { text: '⚠️ Опасная зона' }),
      h('p', { 'class': 'nbs-note', text: 'Полный сброс удалит весь прогресс. Перед этим рекомендуем сделать резервную копию. Потребуется двойное подтверждение.' }),
      makeButton('🗑️ Сбросить все данные', 'danger', resetFlow)
    ]);
  }

  /* ---------- О приложении ---------- */

  function buildAbout() {
    return h('section', { 'class': 'nbs-card nbs-about' }, [
      h('h2', { text: 'ℹ️ О приложении' }),
      h('div', { 'class': 'nbs-warn', text: '🎭 NaebBet — игра только для развлечения. Здесь нет реальных денег, ставок на деньги, пополнения и вывода средств.' }),
      h('p', { text: 'Все ставки делаются виртуальными NB-монетами. Они не имеют никакой реальной стоимости, их нельзя купить, продать или обменять.' }),
      h('p', { text: 'Приложение работает полностью офлайн: данные хранятся только на вашем устройстве, ничего не отправляется в интернет.' }),
      h('p', { text: 'Выигрыш в игре не означает выигрыш в реальной жизни. Если азартные игры начинают мешать жизни — обратитесь за помощью к специалистам.' }),
      h('div', { 'class': 'nbs-ver', text: 'NaebBet v' + APP_VERSION })
    ]);
  }

  /* ---------- Экран ---------- */

  function render(container) {
    injectStyle();
    state = loadSettings();
    refs = {};

    var back = h('button', { 'class': 'nbs-back', type: 'button', 'aria-label': 'Назад', text: '←' });
    listen(back, 'click', function () {
      playSound('click');
      if (NB.Router && NB.Router.back) { NB.Router.back(); }
    });

    rootEl = h('div', { 'class': 'nbs' }, [
      h('div', { 'class': 'nbs-head' }, [
        back,
        h('h1', { 'class': 'nbs-title', text: '⚙️ Настройки' })
      ]),
      buildSound(),
      buildFeedback(),
      buildBets(),
      buildBackup(),
      buildReset(),
      buildAbout()
    ]);

    container.innerHTML = '';
    container.appendChild(rootEl);
  }

  var screen = {
    mount: function (container /*, params */) {
      screen.unmount();
      render(container);
    },
    unmount: function () {
      var i;
      for (i = 0; i < cleanups.length; i++) {
        try { cleanups[i](); } catch (e) { /* игнор */ }
      }
      cleanups = [];
      for (i = 0; i < timers.length; i++) { clearTimeout(timers[i]); }
      timers = [];
      if (rootEl && rootEl.parentNode) { rootEl.parentNode.removeChild(rootEl); }
      rootEl = null;
      refs = {};
    }
  };

  // Применяем сохранённые настройки сразу при загрузке файла
  state = loadSettings();
  applyAll();

  if (NB.Router && NB.Router.register) {
    NB.Router.register('settings', screen);
  }

  NB.SettingsScreen = screen;
})();