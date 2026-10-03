/**
 * NaebBet — js/core/stats.js
 * Модуль NB.Stats: статистика по играм и в целом.
 *
 * Хранение (через NB.Storage, ключ "stats", префикс "nb_" добавляет Storage):
 *  - agg      — глобальные агрегаты (копятся навсегда);
 *  - games    — агрегаты по каждой игре (копятся навсегда);
 *  - daily    — статистика по дням (хранится до 400 последних дней);
 *  - history  — последние 1000 раундов (более старые «сжимаются» в агрегаты,
 *               т.к. агрегаты обновляются инкрементально при каждом раунде);
 *  - balance  — максимальный и минимальный баланс за всё время.
 *
 * Классификация раунда: payout > bet — победа, payout === bet — ничья,
 * payout < bet — поражение. Ничья серию не прерывает и не продлевает.
 * winRate возвращается в процентах (0..100).
 */
(function (global) {
  'use strict';

  var NB = global.NB = global.NB || {};

  // ---------- Константы ----------
  var KEY = 'stats';
  var SCHEMA_VERSION = 1;
  var MAX_HISTORY = 1000;      // максимум раундов в истории
  var MAX_DAILY_DAYS = 400;    // сколько дней хранить в daily
  var MAX_GAP_MS = 120000;     // максимум засчитываемой паузы между раундами (простой не считаем)
  var FIRST_ROUND_MS = 15000;  // время, засчитываемое за самый первый раунд
  var SAVE_DELAY = 400;        // дебаунс записи в Storage, мс
  var DEDUPE_MS = 2000;        // окно сопоставления «прямой вызов + событие»
  var DETAILS_MAX_LEN = 400;   // максимальный размер details в истории (JSON-символов)

  // ---------- Внутреннее состояние ----------
  var state = null;
  var saveTimer = null;
  var bound = false;
  var recent = [];             // недавние раунды для защиты от двойной записи

  // ---------- Утилиты ----------
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function r2(x) { return Math.round(x * 100) / 100; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // Ключ дня в локальном времени: YYYY-MM-DD
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function newAgg() {
    return {
      rounds: 0, bet: 0, payout: 0,
      wins: 0, losses: 0, pushes: 0,
      maxBet: 0, maxWin: 0, maxProfit: 0, maxLoss: 0,
      cur: 0,        // текущая серия: >0 победы подряд, <0 поражения подряд
      best: 0,       // лучшая серия побед
      worst: 0,      // худшая серия поражений (положительное число)
      timeMs: 0, firstTs: 0, lastTs: 0
    };
  }

  function newDay() {
    return { rounds: 0, bet: 0, payout: 0, wins: 0, losses: 0, pushes: 0, timeMs: 0 };
  }

  function newState() {
    return {
      v: SCHEMA_VERSION,
      agg: newAgg(),
      games: {},
      daily: {},
      history: [],
      balance: { max: null, min: null, maxTs: 0, minTs: 0 },
      lastTs: 0
    };
  }

  // Приводим агрегат к валидному виду (защита от повреждённых данных)
  function fixObj(src, tpl) {
    var out = {};
    for (var k in tpl) {
      if (Object.prototype.hasOwnProperty.call(tpl, k)) {
        out[k] = (src && isNum(src[k])) ? src[k] : tpl[k];
      }
    }
    return out;
  }

  // Миграции схемы: при росте SCHEMA_VERSION добавлять шаги сюда
  function migrate(raw) {
    var v = (raw && isNum(raw.v)) ? raw.v : 0;
    if (v < 1) {
      raw.v = 1; // версия 0 → 1: поля нормализуются в normalize()
    }
    return raw;
  }

  function normalize(raw) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }
    if (!raw || typeof raw !== 'object') return newState();
    raw = migrate(raw);

    var s = newState();
    s.agg = fixObj(raw.agg, newAgg());

    if (raw.games && typeof raw.games === 'object') {
      for (var g in raw.games) {
        if (Object.prototype.hasOwnProperty.call(raw.games, g)) {
          s.games[g] = fixObj(raw.games[g], newAgg());
        }
      }
    }
    if (raw.daily && typeof raw.daily === 'object') {
      for (var d in raw.daily) {
        if (Object.prototype.hasOwnProperty.call(raw.daily, d)) {
          s.daily[d] = fixObj(raw.daily[d], newDay());
        }
      }
    }
    if (Array.isArray(raw.history)) {
      for (var i = 0; i < raw.history.length; i++) {
        var h = raw.history[i];
        if (h && typeof h.g === 'string' && isNum(h.b) && isNum(h.p) && isNum(h.ts)) {
          s.history.push(h);
        }
      }
      if (s.history.length > MAX_HISTORY) {
        s.history = s.history.slice(s.history.length - MAX_HISTORY);
      }
    }
    if (raw.balance && typeof raw.balance === 'object') {
      var b = raw.balance;
      s.balance.max = isNum(b.max) ? b.max : null;
      s.balance.min = isNum(b.min) ? b.min : null;
      s.balance.maxTs = isNum(b.maxTs) ? b.maxTs : 0;
      s.balance.minTs = isNum(b.minTs) ? b.minTs : 0;
    }
    s.lastTs = isNum(raw.lastTs) ? raw.lastTs : 0;
    return s;
  }

  function load() {
    var raw = null;
    try {
      if (NB.Storage && typeof NB.Storage.get === 'function') {
        raw = NB.Storage.get(KEY, null);
      }
    } catch (e) { raw = null; }
    return normalize(raw);
  }

  // Ленивая загрузка состояния (порядок подключения файлов не критичен)
  function S() {
    if (!state) state = load();
    return state;
  }

  // ---------- Сохранение ----------
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!state) return;
    try {
      if (NB.Storage && typeof NB.Storage.set === 'function') {
        NB.Storage.set(KEY, state);
      }
    } catch (e) { /* переполнение хранилища и т.п. — не роняем игру */ }
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(flush, SAVE_DELAY);
  }

  // ---------- Баланс: максимум и минимум ----------
  function trackBalance(b, ts) {
    if (!isNum(b)) return;
    var bal = S().balance;
    ts = isNum(ts) ? ts : Date.now();
    if (bal.max === null || b > bal.max) { bal.max = b; bal.maxTs = ts; }
    if (bal.min === null || b < bal.min) { bal.min = b; bal.minTs = ts; }
  }

  function walletBalance() {
    try {
      if (NB.Wallet && typeof NB.Wallet.getBalance === 'function') {
        var b = NB.Wallet.getBalance();
        return isNum(b) ? b : null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- Применение раунда к агрегату ----------
  function applyRound(a, bet, payout, result, net, ts, dur) {
    a.rounds++;
    a.bet = r2(a.bet + bet);
    a.payout = r2(a.payout + payout);
    a.timeMs += dur;
    if (!a.firstTs) a.firstTs = ts;
    a.lastTs = ts;
    if (bet > a.maxBet) a.maxBet = bet;

    if (result === 'win') {
      a.wins++;
      if (payout > a.maxWin) a.maxWin = payout;
      if (net > a.maxProfit) a.maxProfit = net;
      a.cur = a.cur > 0 ? a.cur + 1 : 1;
      if (a.cur > a.best) a.best = a.cur;
    } else if (result === 'loss') {
      a.losses++;
      if (-net > a.maxLoss) a.maxLoss = r2(-net);
      a.cur = a.cur < 0 ? a.cur - 1 : -1;
      if (-a.cur > a.worst) a.worst = -a.cur;
    } else {
      a.pushes++;
    }
  }

  function applyDay(d, bet, payout, result, dur) {
    d.rounds++;
    d.bet = r2(d.bet + bet);
    d.payout = r2(d.payout + payout);
    d.timeMs += dur;
    if (result === 'win') d.wins++;
    else if (result === 'loss') d.losses++;
    else d.pushes++;
  }

  function classify(bet, payout) {
    if (payout > bet) return 'win';
    if (payout === bet) return 'push';
    return 'loss';
  }

  function shortResult(r) { return r === 'win' ? 'w' : (r === 'push' ? 'p' : 'l'); }
  function longResult(c) { return c === 'w' ? 'win' : (c === 'p' ? 'push' : 'loss'); }

  // Нормализация имени результата из фильтра
  function normResultFilter(r) {
    if (!r) return null;
    r = String(r).toLowerCase();
    if (r === 'win' || r === 'w' || r === 'wins') return 'win';
    if (r === 'loss' || r === 'lose' || r === 'l' || r === 'losses') return 'loss';
    if (r === 'push' || r === 'draw' || r === 'p' || r === 'tie') return 'push';
    return null;
  }

  // Компактное сохранение details (слишком большие данные отбрасываем)
  function compactDetails(d) {
    if (d === undefined || d === null) return undefined;
    try {
      var s = JSON.stringify(d);
      if (s && s.length <= DETAILS_MAX_LEN) return JSON.parse(s);
    } catch (e) { /* ignore */ }
    return undefined;
  }

  // ---------- Защита от двойной записи ----------
  // Раунд может прийти и прямым вызовом recordRound, и событием round:settled.
  // Раунды разных источников с одинаковой подписью в окне DEDUPE_MS «склеиваются».
  function isDuplicate(src, sig) {
    var now = Date.now();
    recent = recent.filter(function (x) { return now - x.t <= DEDUPE_MS; });
    for (var i = 0; i < recent.length; i++) {
      var x = recent[i];
      if (!x.matched && x.src !== src && x.sig === sig) {
        x.matched = true;
        return true;
      }
    }
    recent.push({ sig: sig, t: now, src: src, matched: false });
    return false;
  }

  function pruneDaily() {
    var s = S();
    var keys = Object.keys(s.daily);
    if (keys.length <= MAX_DAILY_DAYS) return;
    keys.sort();
    var extra = keys.length - MAX_DAILY_DAYS;
    for (var i = 0; i < extra; i++) delete s.daily[keys[i]];
  }

  // ---------- Запись раунда ----------
  function record(r, src) {
    if (!r || typeof r !== 'object') return null;
    var gameId = r.gameId;
    if (typeof gameId !== 'string' || !gameId) return null;

    var bet = Number(r.bet);
    if (!isFinite(bet) || bet < 0) return null;
    var payout = Number(r.payout);
    if (!isFinite(payout) || payout < 0) payout = 0;

    if (isDuplicate(src, gameId + '|' + bet + '|' + payout)) return null;

    var s = S();
    var ts = isNum(r.ts) ? r.ts : Date.now();
    var net = r2(payout - bet);
    var result = classify(bet, payout);

    // Время в игре: явная длительность либо пауза с прошлого раунда (с ограничением)
    var dur;
    if (r.details && isNum(r.details.durationMs) && r.details.durationMs > 0) {
      dur = Math.min(r.details.durationMs, MAX_GAP_MS);
    } else if (s.lastTs) {
      dur = clamp(ts - s.lastTs, 0, MAX_GAP_MS);
    } else {
      dur = FIRST_ROUND_MS;
    }
    if (ts > s.lastTs) s.lastTs = ts;

    // Агрегаты
    applyRound(s.agg, bet, payout, result, net, ts, dur);
    if (!s.games[gameId]) s.games[gameId] = newAgg();
    applyRound(s.games[gameId], bet, payout, result, net, ts, dur);

    // По дням
    var dk = dayKey(ts);
    if (!s.daily[dk]) { s.daily[dk] = newDay(); pruneDaily(); }
    applyDay(s.daily[dk], bet, payout, result, dur);

    // Баланс
    var bal = walletBalance();
    trackBalance(bal, ts);

    // История (с автосжатием: старше MAX_HISTORY отбрасывается, итоги уже в агрегатах)
    var entry = { g: gameId, b: bet, p: payout, ts: ts, r: shortResult(result) };
    if (bal !== null) entry.bal = bal;
    var det = compactDetails(r.details);
    if (det !== undefined) entry.d = det;
    s.history.push(entry);
    if (s.history.length > MAX_HISTORY) {
      s.history.splice(0, s.history.length - MAX_HISTORY);
    }

    scheduleSave();

    if (NB.Events && typeof NB.Events.emit === 'function') {
      try {
        NB.Events.emit('stats:update', { gameId: gameId, bet: bet, payout: payout, net: net, result: result });
      } catch (e) { /* ignore */ }
    }
    return toHistoryItem(entry);
  }

  function toHistoryItem(h) {
    var item = {
      gameId: h.g,
      bet: h.b,
      payout: h.p,
      net: r2(h.p - h.b),
      result: longResult(h.r),
      ts: h.ts
    };
    if (h.bal !== undefined) item.balance = h.bal;
    if (h.d !== undefined) item.details = h.d;
    return item;
  }

  // ---------- Представления (расчётные значения) ----------
  function view(a) {
    var rounds = a.rounds;
    return {
      rounds: rounds,
      totalBet: r2(a.bet),
      totalWon: r2(a.payout),
      net: r2(a.payout - a.bet),
      wins: a.wins,
      losses: a.losses,
      pushes: a.pushes,
      winRate: rounds ? Math.round(a.wins / rounds * 1000) / 10 : 0,
      maxBet: a.maxBet,
      maxWin: a.maxWin,
      maxProfit: a.maxProfit,
      maxLoss: a.maxLoss,
      bestStreak: a.best,
      worstStreak: a.worst,
      currentStreak: a.cur,
      avgBet: rounds ? r2(a.bet / rounds) : 0,
      avgPayout: rounds ? r2(a.payout / rounds) : 0,
      actualRtp: a.bet > 0 ? Math.round(a.payout / a.bet * 1000) / 10 : 0,
      timeMs: a.timeMs,
      firstTs: a.firstTs,
      lastTs: a.lastTs
    };
  }

  function gameMeta(id) {
    var meta = { name: id, icon: '🎲' };
    try {
      if (NB.Games && typeof NB.Games.get === 'function') {
        var g = NB.Games.get(id);
        if (g) {
          if (g.name) meta.name = g.name;
          if (g.icon) meta.icon = g.icon;
        }
      }
    } catch (e) { /* ignore */ }
    return meta;
  }

  function dayView(key, d) {
    return {
      date: key,
      rounds: d.rounds,
      bet: r2(d.bet),
      payout: r2(d.payout),
      net: r2(d.payout - d.bet),
      wins: d.wins,
      losses: d.losses,
      pushes: d.pushes,
      winRate: d.rounds ? Math.round(d.wins / d.rounds * 1000) / 10 : 0,
      timeMs: d.timeMs
    };
  }

  // ---------- Публичные методы ----------
  function recordRound(r) {
    return record(r, 'direct');
  }

  function getFavoriteGame() {
    var s = S();
    var bestId = null, best = null;
    for (var id in s.games) {
      if (!Object.prototype.hasOwnProperty.call(s.games, id)) continue;
      var a = s.games[id];
      if (!a.rounds) continue;
      if (!best || a.rounds > best.rounds || (a.rounds === best.rounds && a.lastTs > best.lastTs)) {
        best = a; bestId = id;
      }
    }
    if (!best) return null;
    var meta = gameMeta(bestId);
    return {
      gameId: bestId,
      id: bestId,
      name: meta.name,
      icon: meta.icon,
      rounds: best.rounds,
      share: s.agg.rounds ? Math.round(best.rounds / s.agg.rounds * 1000) / 10 : 0
    };
  }

  // Самая прибыльная (dir = 1) или самая убыточная (dir = -1) игра
  function extremeGame(dir) {
    var s = S();
    var bestId = null, bestNet = 0;
    for (var id in s.games) {
      if (!Object.prototype.hasOwnProperty.call(s.games, id)) continue;
      var a = s.games[id];
      if (!a.rounds) continue;
      var net = r2(a.payout - a.bet);
      if (dir > 0 ? net > bestNet : net < bestNet) { bestNet = net; bestId = id; }
    }
    if (bestId === null) return null;
    var meta = gameMeta(bestId);
    return { gameId: bestId, id: bestId, name: meta.name, icon: meta.icon, net: bestNet };
  }

  function getGlobal() {
    var s = S();
    var v = view(s.agg);
    v.favoriteGame = getFavoriteGame();
    v.mostProfitableGame = extremeGame(1);
    v.mostLosingGame = extremeGame(-1);
    v.maxBalance = s.balance.max;
    v.minBalance = s.balance.min;
    v.maxBalanceTs = s.balance.maxTs;
    v.minBalanceTs = s.balance.minTs;
    v.gamesPlayed = Object.keys(s.games).length;
    v.daysPlayed = Object.keys(s.daily).length;
    var today = s.daily[dayKey(Date.now())];
    v.today = dayView(dayKey(Date.now()), today || newDay());
    return v;
  }

  function getGame(gameId) {
    var s = S();
    var a = s.games[gameId] || newAgg();
    var v = view(a);
    v.gameId = gameId;
    return v;
  }

  function getHistory(opts) {
    opts = opts || {};
    var s = S();
    var limit = clamp(Math.floor(Number(opts.limit)) || 50, 1, MAX_HISTORY);
    var filterRes = normResultFilter(opts.result);
    var gid = opts.gameId || null;
    var out = [];
    for (var i = s.history.length - 1; i >= 0 && out.length < limit; i--) {
      var h = s.history[i];
      if (gid && h.g !== gid) continue;
      if (filterRes && longResult(h.r) !== filterRes) continue;
      out.push(toHistoryItem(h));
    }
    return out; // от новых к старым
  }

  function getStreaks() {
    var s = S();
    var a = s.agg;
    var byGame = {};
    for (var id in s.games) {
      if (!Object.prototype.hasOwnProperty.call(s.games, id)) continue;
      var g = s.games[id];
      byGame[id] = {
        current: g.cur,
        type: g.cur > 0 ? 'win' : (g.cur < 0 ? 'loss' : 'none'),
        best: g.best,
        worst: g.worst
      };
    }
    return {
      current: a.cur,                       // со знаком: +N побед / -N поражений
      type: a.cur > 0 ? 'win' : (a.cur < 0 ? 'loss' : 'none'),
      count: Math.abs(a.cur),
      best: a.best,
      worst: a.worst,
      byGame: byGame
    };
  }

  // Статистика по дням за последние N дней (по возрастанию дат, пустые дни включены)
  function getDaily(days) {
    var s = S();
    days = clamp(Math.floor(Number(days)) || 7, 1, MAX_DAILY_DAYS);
    var base = new Date();
    base.setHours(12, 0, 0, 0); // полдень — безопасно для перехода на летнее время
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(base.getTime());
      d.setDate(d.getDate() - i);
      var key = dayKey(d.getTime());
      out.push(dayView(key, s.daily[key] || newDay()));
    }
    return out;
  }

  // Данные для графиков: { type, points: [{x, label, value, ...}] }
  // Типы: 'balance', 'net', 'daily', 'games', 'results', 'winrate'
  function getChartData(type) {
    var s = S();
    var points = [];
    var i;

    switch (type) {
      case 'balance':
        for (i = 0; i < s.history.length; i++) {
          if (isNum(s.history[i].bal)) {
            points.push({ x: points.length, ts: s.history[i].ts, label: String(points.length + 1), value: s.history[i].bal });
          }
        }
        break;

      case 'net':
      case 'cumulative':
        var sum = 0;
        for (i = 0; i < s.history.length; i++) {
          sum = r2(sum + (s.history[i].p - s.history[i].b));
          points.push({ x: i, ts: s.history[i].ts, label: String(i + 1), value: sum });
        }
        break;

      case 'daily':
        var days = getDaily(30);
        for (i = 0; i < days.length; i++) {
          points.push({
            x: i, label: days[i].date.slice(5), date: days[i].date,
            value: days[i].net, rounds: days[i].rounds, winRate: days[i].winRate
          });
        }
        break;

      case 'games':
        var ids = Object.keys(s.games).filter(function (id) { return s.games[id].rounds > 0; });
        ids.sort(function (a, b) { return s.games[b].rounds - s.games[a].rounds; });
        for (i = 0; i < ids.length; i++) {
          var a = s.games[ids[i]];
          var meta = gameMeta(ids[i]);
          points.push({
            x: i, gameId: ids[i], label: meta.name, icon: meta.icon,
            value: a.rounds, net: r2(a.payout - a.bet),
            winRate: Math.round(a.wins / a.rounds * 1000) / 10
          });
        }
        break;

      case 'results':
        points.push({ x: 0, label: 'Победы', key: 'win', value: s.agg.wins });
        points.push({ x: 1, label: 'Поражения', key: 'loss', value: s.agg.losses });
        points.push({ x: 2, label: 'Ничьи', key: 'push', value: s.agg.pushes });
        break;

      case 'winrate':
        var WIN = 20; // скользящее окно в раундах
        for (i = 0; i < s.history.length; i++) {
          var from = Math.max(0, i - WIN + 1);
          var w = 0, cnt = i - from + 1;
          for (var j = from; j <= i; j++) if (s.history[j].r === 'w') w++;
          points.push({ x: i, ts: s.history[i].ts, label: String(i + 1), value: Math.round(w / cnt * 1000) / 10 });
        }
        break;

      default:
        break;
    }
    return { type: type, points: points };
  }

  function reset() {
    state = newState();
    recent = [];
    var b = walletBalance();
    if (b !== null) trackBalance(b, Date.now());
    flush();
    if (NB.Events && typeof NB.Events.emit === 'function') {
      try { NB.Events.emit('stats:reset', {}); } catch (e) { /* ignore */ }
    }
  }

  // ---------- Подписка на события ----------
  function onSettled(data) {
    if (!data || typeof data !== 'object') return;
    record({
      gameId: data.gameId,
      bet: data.bet,
      payout: data.payout,
      details: data.details,
      ts: data.ts
    }, 'event');
  }

  function onBalance(data) {
    var b = null;
    if (data && typeof data === 'object') {
      if (isNum(data.balance)) b = data.balance;
      else if (isNum(data.newBalance)) b = data.newBalance;
      else if (isNum(data.to)) b = data.to;
    } else if (isNum(data)) {
      b = data;
    }
    if (b === null) b = walletBalance();
    if (b === null) return;
    trackBalance(b, Date.now());
    scheduleSave();
  }

  function bind() {
    if (bound) return;
    if (!NB.Events || typeof NB.Events.on !== 'function') return;
    bound = true;
    NB.Events.on('round:settled', onSettled);
    NB.Events.on('balance:change', onBalance);
    var b = walletBalance();
    if (b !== null) { trackBalance(b, Date.now()); scheduleSave(); }
  }

  // ---------- Инициализация ----------
  bind();
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', bind);
    // Сбрасываем отложенную запись при сворачивании/закрытии (важно для PWA на телефоне)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', flush);
    global.addEventListener('beforeunload', flush);
  }

  // ---------- Экспорт ----------
  NB.Stats = {
    recordRound: recordRound,
    getGlobal: getGlobal,
    getGame: getGame,
    getHistory: getHistory,
    getFavoriteGame: getFavoriteGame,
    getStreaks: getStreaks,
    getDaily: getDaily,
    getChartData: getChartData,
    reset: reset
  };

})(typeof window !== 'undefined' ? window : this);