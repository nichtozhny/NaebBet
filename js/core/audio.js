/* ==========================================================================
   NaebBet — js/core/audio.js
   Модуль NB.Audio: синтез звуков через WebAudio (без аудиофайлов).
   API: play(name), setVolume(0..1), setMuted(bool), isMuted()
   Доп.: getVolume(), setVibration(bool), isVibration(), unlock()
   ========================================================================== */
(function (global) {
  'use strict';

  var NB = global.NB = global.NB || {};

  // Ключи в хранилище (префикс nb_ добавляется/ожидается Storage)
  var KEY_VOLUME = 'nb_audio_volume';
  var KEY_MUTED = 'nb_audio_muted';
  var KEY_VIBRATION = 'nb_vibration';

  // Состояние модуля
  var ctx = null;            // AudioContext (создаётся лениво)
  var master = null;         // главный GainNode
  var compressor = null;     // компрессор, чтобы не клиппило
  var noiseBuffer = null;    // буфер белого шума
  var unlocked = false;      // был ли первый жест пользователя
  var volume = 0.7;
  var muted = false;
  var vibration = true;
  var lastPlay = {};         // троттлинг частых звуков (tick/click)
  var pendingTimers = [];    // таймеры составных звуков

  // ---------- Безопасная работа с хранилищем ----------
  function storeGet(key, def) {
    try {
      if (NB.Storage && typeof NB.Storage.get === 'function') {
        var v = NB.Storage.get(key, def);
        return v === undefined || v === null ? def : v;
      }
    } catch (e) { /* игнорируем */ }
    return def;
  }

  function storeSet(key, val) {
    try {
      if (NB.Storage && typeof NB.Storage.set === 'function') {
        NB.Storage.set(key, val);
      }
    } catch (e) { /* игнорируем */ }
  }

  function loadSettings() {
    var v = Number(storeGet(KEY_VOLUME, 0.7));
    volume = isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
    muted = storeGet(KEY_MUTED, false) === true;
    vibration = storeGet(KEY_VIBRATION, true) !== false;
  }

  // ---------- Инициализация AudioContext ----------
  function ensureContext() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      buildNoise();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  // Буфер белого шума на 1 секунду (используется для card, spin, lose)
  function buildNoise() {
    var len = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Разблокировка по первому касанию (политика автозапуска браузеров)
  function unlock() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch (e) { /* игнорируем */ }
    }
    if (!unlocked) {
      unlocked = true;
      // Тихий «пустой» звук для iOS Safari
      try {
        var b = ctx.createBuffer(1, 1, 22050);
        var s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
      } catch (e) { /* игнорируем */ }
    }
  }

  function bindUnlock() {
    var events = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown', 'click'];
    function handler() {
      unlock();
      if (unlocked && ctx && ctx.state === 'running') {
        events.forEach(function (ev) {
          document.removeEventListener(ev, handler, true);
        });
      }
    }
    events.forEach(function (ev) {
      document.addEventListener(ev, handler, true);
    });
  }

  // ---------- Примитивы синтеза ----------

  // Тон: осциллятор + огибающая (attack/decay). opts: type, freq, freqEnd, start, dur, vol, attack
  function tone(o) {
    var t0 = ctx.currentTime + (o.start || 0);
    var dur = o.dur || 0.15;
    var attack = o.attack === undefined ? 0.005 : o.attack;
    var vol = o.vol === undefined ? 0.3 : o.vol;

    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd && o.freqEnd !== o.freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    osc.onended = function () {
      try { osc.disconnect(); g.disconnect(); } catch (e) { /* игнорируем */ }
    };
  }

  // Шум с полосовым/ФНЧ/ФВЧ фильтром. opts: start, dur, vol, filter, freq, freqEnd, q, attack
  function noise(o) {
    var t0 = ctx.currentTime + (o.start || 0);
    var dur = o.dur || 0.1;
    var vol = o.vol === undefined ? 0.2 : o.vol;
    var attack = o.attack === undefined ? 0.003 : o.attack;

    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2000, t0);
    if (o.freqEnd) {
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
    }
    f.Q.value = o.q === undefined ? 1 : o.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f);
    f.connect(g);
    g.connect(master);
    // случайный сдвиг, чтобы шум не повторялся одинаково
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
    src.onended = function () {
      try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* игнорируем */ }
    };
  }

  // Арпеджио/мелодия: массив частот с шагом по времени
  function melody(freqs, step, o) {
    for (var i = 0; i < freqs.length; i++) {
      tone({
        type: o.type || 'triangle',
        freq: freqs[i],
        start: (o.start || 0) + i * step,
        dur: o.dur || step * 1.6,
        vol: o.vol === undefined ? 0.25 : o.vol,
        attack: o.attack
      });
    }
  }

  // ---------- Описание звуков ----------
  var SOUNDS = {
    // Короткий приятный клик интерфейса
    click: function () {
      tone({ type: 'sine', freq: 900, freqEnd: 600, dur: 0.05, vol: 0.18, attack: 0.002 });
      noise({ filter: 'highpass', freq: 4000, dur: 0.025, vol: 0.05 });
    },

    // Обычный выигрыш: восходящее мажорное арпеджио
    win: function () {
      melody([523.25, 659.25, 783.99, 1046.5], 0.09, { type: 'triangle', dur: 0.22, vol: 0.28 });
      melody([1046.5, 1318.5], 0.09, { type: 'sine', start: 0.1, dur: 0.3, vol: 0.1 });
    },

    // Крупный выигрыш: фанфары + блеск + «дождь» монет
    bigwin: function () {
      var seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568.0, 2093.0];
      melody(seq, 0.085, { type: 'triangle', dur: 0.28, vol: 0.3 });
      melody(seq, 0.085, { type: 'sine', start: 0.01, dur: 0.3, vol: 0.12 });
      // финальный аккорд
      var t = seq.length * 0.085 + 0.05;
      [1046.5, 1318.5, 1568.0, 2093.0].forEach(function (f) {
        tone({ type: 'triangle', freq: f, start: t, dur: 0.9, vol: 0.2, attack: 0.01 });
      });
      tone({ type: 'sawtooth', freq: 261.63, start: t, dur: 0.9, vol: 0.08, attack: 0.02 });
      // сыплющиеся монеты
      for (var i = 0; i < 9; i++) {
        var st = 0.15 + i * 0.11 + Math.random() * 0.05;
        var base = 1800 + Math.random() * 1400;
        tone({ type: 'square', freq: base, freqEnd: base * 1.5, start: st, dur: 0.07, vol: 0.06, attack: 0.001 });
        tone({ type: 'sine', freq: base * 1.5, start: st + 0.04, dur: 0.12, vol: 0.05, attack: 0.001 });
      }
      noise({ filter: 'highpass', freq: 6000, start: t, dur: 0.6, vol: 0.05, attack: 0.02 });
    },

    // Проигрыш: нисходящий минорный «вздох»
    lose: function () {
      tone({ type: 'sawtooth', freq: 392, freqEnd: 196, dur: 0.45, vol: 0.14, attack: 0.01 });
      tone({ type: 'triangle', freq: 311.13, freqEnd: 155.56, start: 0.12, dur: 0.5, vol: 0.18, attack: 0.01 });
      noise({ filter: 'lowpass', freq: 800, freqEnd: 120, dur: 0.4, vol: 0.06 });
    },

    // Монета: двойной металлический «дзынь»
    coin: function () {
      tone({ type: 'square', freq: 1318.5, dur: 0.07, vol: 0.12, attack: 0.001 });
      tone({ type: 'square', freq: 1760, start: 0.07, dur: 0.28, vol: 0.12, attack: 0.001 });
      tone({ type: 'sine', freq: 3520, start: 0.07, dur: 0.2, vol: 0.05, attack: 0.001 });
    },

    // Карта: шорох шума с коротким щелчком
    card: function () {
      noise({ filter: 'bandpass', freq: 3500, freqEnd: 1200, q: 0.8, dur: 0.09, vol: 0.22, attack: 0.004 });
      noise({ filter: 'highpass', freq: 5000, start: 0.07, dur: 0.04, vol: 0.1 });
      tone({ type: 'sine', freq: 180, freqEnd: 110, start: 0.07, dur: 0.05, vol: 0.12, attack: 0.002 });
    },

    // Вращение: нарастающий свист с шумом и пульсацией
    spin: function () {
      tone({ type: 'sawtooth', freq: 180, freqEnd: 720, dur: 0.5, vol: 0.09, attack: 0.03 });
      tone({ type: 'sine', freq: 360, freqEnd: 1100, dur: 0.5, vol: 0.08, attack: 0.03 });
      noise({ filter: 'bandpass', freq: 500, freqEnd: 3500, q: 2, dur: 0.5, vol: 0.12, attack: 0.04 });
      for (var i = 0; i < 6; i++) {
        tone({ type: 'square', freq: 300 + i * 40, start: i * 0.08, dur: 0.03, vol: 0.04, attack: 0.001 });
      }
    },

    // Тик: очень короткий сухой щелчок (колесо, таймер)
    tick: function () {
      tone({ type: 'square', freq: 1500, freqEnd: 1100, dur: 0.02, vol: 0.09, attack: 0.001 });
      noise({ filter: 'highpass', freq: 5000, dur: 0.012, vol: 0.05, attack: 0.001 });
    },

    // Ошибка: два низких резких «бзз»
    error: function () {
      tone({ type: 'square', freq: 160, dur: 0.12, vol: 0.14, attack: 0.002 });
      tone({ type: 'square', freq: 130, start: 0.14, dur: 0.18, vol: 0.14, attack: 0.002 });
      tone({ type: 'sawtooth', freq: 80, start: 0.0, dur: 0.3, vol: 0.08, attack: 0.005 });
    }
  };

  // Паттерны вибрации (мс) для звуков
  var VIBRATION = {
    click: 8,
    win: [30, 40, 30],
    bigwin: [60, 50, 60, 50, 120, 60, 200],
    lose: [90],
    coin: 12,
    card: 10,
    spin: 20,
    tick: 5,
    error: [40, 40, 40]
  };

  // Минимальный интервал между одинаковыми звуками (мс)
  var THROTTLE = { tick: 25, click: 40, coin: 30, card: 40 };

  // ---------- Вибрация ----------
  function vibrate(name) {
    if (!vibration) return;
    var pattern = VIBRATION[name];
    if (pattern === undefined) return;
    try {
      if (global.navigator && typeof global.navigator.vibrate === 'function') {
        global.navigator.vibrate(pattern);
      }
    } catch (e) { /* игнорируем */ }
  }

  // ---------- Публичный API ----------
  function play(name) {
    var fn = SOUNDS[name];
    if (!fn) return;

    // Вибрация работает независимо от mute (если включена в настройках)
    vibrate(name);

    if (muted || volume <= 0) return;

    // Троттлинг частых звуков
    var now = Date.now();
    var gap = THROTTLE[name];
    if (gap && lastPlay[name] && now - lastPlay[name] < gap) return;
    lastPlay[name] = now;

    // Контекст создаётся только после первого жеста пользователя
    if (!unlocked) return;
    if (!ensureContext()) return;

    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch (e) { /* игнорируем */ }
    }

    try {
      master.gain.value = volume;
      fn();
    } catch (e) { /* звук не должен ломать игру */ }
  }

  function applyGain() {
    if (!ctx || !master) return;
    var target = muted ? 0 : volume;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
    } catch (e) {
      master.gain.value = target;
    }
  }

  function setVolume(v) {
    v = Number(v);
    if (!isFinite(v)) return;
    volume = Math.min(1, Math.max(0, v));
    storeSet(KEY_VOLUME, volume);
    applyGain();
    emit('audio:change');
  }

  function getVolume() {
    return volume;
  }

  function setMuted(m) {
    muted = !!m;
    storeSet(KEY_MUTED, muted);
    applyGain();
    emit('audio:change');
  }

  function isMuted() {
    return muted;
  }

  function setVibration(on) {
    vibration = !!on;
    storeSet(KEY_VIBRATION, vibration);
    emit('audio:change');
  }

  function isVibration() {
    return vibration;
  }

  function emit(name) {
    try {
      if (NB.Events && typeof NB.Events.emit === 'function') {
        NB.Events.emit(name, { volume: volume, muted: muted, vibration: vibration });
      }
    } catch (e) { /* игнорируем */ }
  }

  // ---------- Старт ----------
  loadSettings();
  bindUnlock();

  // Пауза звука при уходе вкладки в фон, возобновление при возврате
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    try {
      if (document.hidden) {
        if (ctx.state === 'running') ctx.suspend();
      } else if (unlocked && ctx.state === 'suspended') {
        ctx.resume();
      }
    } catch (e) { /* игнорируем */ }
  });

  NB.Audio = {
    play: play,
    setVolume: setVolume,
    getVolume: getVolume,
    setMuted: setMuted,
    isMuted: isMuted,
    setVibration: setVibration,
    isVibration: isVibration,
    unlock: unlock
  };

})(typeof window !== 'undefined' ? window : this);