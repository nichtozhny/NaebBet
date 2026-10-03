/* ==========================================================================
 * NaebBet — js/core/rng.js
 * Модуль NB.RNG: криптографически стойкий генератор случайных чисел.
 * Основа — crypto.getRandomValues. Равномерность без смещения
 * обеспечивается через rejection sampling (отбраковку).
 * Реальных денег нет, валюта виртуальная (NB-монеты).
 * ========================================================================== */
(function (global) {
  'use strict';

  var NB = global.NB = global.NB || {};

  // ---------------------------------------------------------------------
  // Константы
  // ---------------------------------------------------------------------
  var TWO32 = 4294967296;             // 2^32
  var TWO53 = 9007199254740992;       // 2^53
  var POOL_SIZE = 256;                // размер буфера случайных 32-бит слов

  // ---------------------------------------------------------------------
  // Источник энтропии
  // ---------------------------------------------------------------------
  var cryptoObj = global.crypto || global.msCrypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    // Без криптографического источника честная игра невозможна.
    throw new Error('NB.RNG: crypto.getRandomValues недоступен в этом окружении');
  }

  // Пул заранее сгенерированных слов — меньше вызовов к crypto
  var pool = new Uint32Array(POOL_SIZE);
  var poolIndex = POOL_SIZE; // изначально пул "пуст"

  /** Возвращает следующее случайное 32-битное беззнаковое число. */
  function nextU32() {
    if (poolIndex >= POOL_SIZE) {
      cryptoObj.getRandomValues(pool);
      poolIndex = 0;
    }
    return pool[poolIndex++];
  }

  /**
   * Равномерное целое в диапазоне [0, n) без смещения.
   * Для n <= 2^32 — одно 32-битное слово с отбраковкой хвоста.
   * Для n <= 2^53 — 53-битное значение с отбраковкой хвоста.
   */
  function below(n) {
    if (n <= 1) return 0;

    var x, limit;

    if (n <= TWO32) {
      // Отбрасываем значения из "неполного" хвоста, чтобы остаток был равномерным
      limit = TWO32 - (TWO32 % n);
      do {
        x = nextU32();
      } while (x >= limit);
      return x % n;
    }

    // Большие диапазоны (до 2^53)
    limit = TWO53 - (TWO53 % n);
    do {
      x = (nextU32() >>> 11) * TWO32 + nextU32(); // 21 + 32 = 53 бита
    } while (x >= limit);
    return x % n;
  }

  // ---------------------------------------------------------------------
  // Проверки аргументов
  // ---------------------------------------------------------------------
  function assertArrayLike(arr, fnName) {
    if (arr == null || typeof arr.length !== 'number') {
      throw new TypeError('NB.RNG.' + fnName + ': ожидается массив');
    }
  }

  // ---------------------------------------------------------------------
  // Публичный API
  // ---------------------------------------------------------------------

  /**
   * Случайное целое в диапазоне [min, max] включительно.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function int(min, max) {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new TypeError('NB.RNG.int: min и max должны быть целыми числами');
    }
    if (min > max) {
      throw new RangeError('NB.RNG.int: min больше max');
    }
    var range = max - min + 1;
    if (range > TWO53) {
      throw new RangeError('NB.RNG.int: диапазон слишком велик');
    }
    return min + below(range);
  }

  /**
   * Случайное число с плавающей точкой в диапазоне [0, 1).
   * Используется полная 53-битная мантисса double.
   * @returns {number}
   */
  function float() {
    var hi = nextU32() >>> 11; // 21 бит
    var lo = nextU32();        // 32 бита
    return (hi * TWO32 + lo) / TWO53;
  }

  /**
   * Случайный элемент массива.
   * @param {Array} arr
   * @returns {*}
   */
  function pick(arr) {
    assertArrayLike(arr, 'pick');
    if (arr.length === 0) {
      throw new RangeError('NB.RNG.pick: массив пуст');
    }
    return arr[below(arr.length)];
  }

  /**
   * Перемешивание по алгоритму Фишера-Йетса.
   * Исходный массив НЕ изменяется — возвращается новая перемешанная копия.
   * @param {Array} arr
   * @returns {Array}
   */
  function shuffle(arr) {
    assertArrayLike(arr, 'shuffle');
    var res = Array.prototype.slice.call(arr);
    for (var i = res.length - 1; i > 0; i--) {
      var j = below(i + 1);
      var tmp = res[i];
      res[i] = res[j];
      res[j] = tmp;
    }
    return res;
  }

  /**
   * Взвешенный случайный выбор элемента.
   * Веса могут быть целыми или дробными, неотрицательными; сумма > 0.
   * Для целых весов используется точный выбор без смещения.
   * @param {Array} items
   * @param {number[]} weights
   * @returns {*}
   */
  function weighted(items, weights) {
    assertArrayLike(items, 'weighted');
    assertArrayLike(weights, 'weighted');
    if (items.length === 0) {
      throw new RangeError('NB.RNG.weighted: список пуст');
    }
    if (items.length !== weights.length) {
      throw new RangeError('NB.RNG.weighted: длины items и weights не совпадают');
    }

    var total = 0;
    var allInt = true;
    var lastPositive = -1;
    var i, w;

    for (i = 0; i < weights.length; i++) {
      w = weights[i];
      if (typeof w !== 'number' || !isFinite(w) || w < 0) {
        throw new RangeError('NB.RNG.weighted: вес должен быть конечным неотрицательным числом');
      }
      if (w > 0) lastPositive = i;
      if (!Number.isInteger(w)) allInt = false;
      total += w;
    }
    if (!(total > 0) || lastPositive < 0) {
      throw new RangeError('NB.RNG.weighted: сумма весов должна быть больше нуля');
    }

    // Точный путь: целые веса, сумма в безопасном диапазоне
    var r = (allInt && total <= TWO53) ? below(total) : float() * total;

    var acc = 0;
    for (i = 0; i < weights.length; i++) {
      w = weights[i];
      if (w <= 0) continue;
      acc += w;
      if (r < acc) return items[i];
    }
    // Страховка от погрешности округления дробных весов
    return items[lastPositive];
  }

  // ---------------------------------------------------------------------
  // Самотест
  // ---------------------------------------------------------------------

  /** Критическое значение хи-квадрат (p = 0.001), приближение Уилсона-Хилферти. */
  function chiCritical(df) {
    var z = 3.0902; // квантиль нормального распределения для 0.999
    var a = 2 / (9 * df);
    return df * Math.pow(1 - a + z * Math.sqrt(a), 3);
  }

  /** Считает статистику хи-квадрат для равномерных ожиданий. */
  function chiSquareUniform(counts, total) {
    var expected = total / counts.length;
    var chi = 0;
    for (var i = 0; i < counts.length; i++) {
      var d = counts[i] - expected;
      chi += d * d / expected;
    }
    return chi;
  }

  /** Строит строки отчёта по распределению. */
  function buildRows(labels, counts, total, expectedShares) {
    var rows = [];
    for (var i = 0; i < counts.length; i++) {
      var share = expectedShares ? expectedShares[i] : 1 / counts.length;
      rows.push({
        'Значение': labels[i],
        'Выпало': counts[i],
        'Доля, %': +(counts[i] / total * 100).toFixed(3),
        'Ожидалось, %': +(share * 100).toFixed(3)
      });
    }
    return rows;
  }

  /** Печать таблицы в консоль (с запасным вариантом без console.table). */
  function printTable(title, rows) {
    console.log('— ' + title);
    if (typeof console.table === 'function') {
      console.table(rows);
    } else {
      for (var i = 0; i < rows.length; i++) {
        console.log(JSON.stringify(rows[i]));
      }
    }
  }

  /**
   * Самотест: 100000 бросков по каждому сценарию, вывод распределения в консоль.
   * Возвращает объект с итогами (ok === true, если все проверки пройдены).
   * Тест статистический: при p = 0.001 крайне редко возможен ложный сигнал —
   * тогда достаточно запустить его повторно.
   * @returns {{ok:boolean, tests:Array}}
   */
  function selfTest() {
    var N = 100000;
    var tests = [];
    var i, v;

    console.log('NB.RNG.selfTest: старт, бросков на сценарий: ' + N);
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();

    // 1) Кубик d6: int(1, 6)
    var dice = [0, 0, 0, 0, 0, 0];
    for (i = 0; i < N; i++) dice[int(1, 6) - 1]++;
    var chiDice = chiSquareUniform(dice, N);
    var critDice = chiCritical(5);
    printTable('int(1, 6) — кубик', buildRows([1, 2, 3, 4, 5, 6], dice, N));
    tests.push({ name: 'int(1,6)', chi: chiDice, critical: critDice, ok: chiDice < critDice });

    // 2) Рулетка: int(0, 36)
    var roul = [];
    var roulLabels = [];
    for (i = 0; i <= 36; i++) { roul.push(0); roulLabels.push(i); }
    for (i = 0; i < N; i++) roul[int(0, 36)]++;
    var chiRoul = chiSquareUniform(roul, N);
    var critRoul = chiCritical(36);
    printTable('int(0, 36) — рулетка', buildRows(roulLabels, roul, N));
    tests.push({ name: 'int(0,36)', chi: chiRoul, critical: critRoul, ok: chiRoul < critRoul });

    // 3) float(): 10 равных корзин, среднее, границы
    var buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var sum = 0;
    var floatInRange = true;
    for (i = 0; i < N; i++) {
      v = float();
      if (!(v >= 0 && v < 1)) floatInRange = false;
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    var chiFloat = chiSquareUniform(buckets, N);
    var critFloat = chiCritical(9);
    var mean = sum / N;
    var bucketLabels = [];
    for (i = 0; i < 10; i++) bucketLabels.push((i / 10).toFixed(1) + '–' + ((i + 1) / 10).toFixed(1));
    printTable('float() — корзины по 0.1 (среднее = ' + mean.toFixed(5) + ')',
      buildRows(bucketLabels, buckets, N));
    tests.push({
      name: 'float()',
      chi: chiFloat,
      critical: critFloat,
      ok: chiFloat < critFloat && floatInRange && Math.abs(mean - 0.5) < 0.01
    });

    // 4) pick(): выбор из 5 элементов
    var pickItems = ['A', 'B', 'C', 'D', 'E'];
    var pickCounts = [0, 0, 0, 0, 0];
    for (i = 0; i < N; i++) pickCounts[pickItems.indexOf(pick(pickItems))]++;
    var chiPick = chiSquareUniform(pickCounts, N);
    var critPick = chiCritical(4);
    printTable('pick([A..E])', buildRows(pickItems, pickCounts, N));
    tests.push({ name: 'pick()', chi: chiPick, critical: critPick, ok: chiPick < critPick });

    // 5) shuffle(): все 6 перестановок трёх элементов должны быть равновероятны
    var permKeys = ['123', '132', '213', '231', '312', '321'];
    var permCounts = [0, 0, 0, 0, 0, 0];
    var base = [1, 2, 3];
    for (i = 0; i < N; i++) permCounts[permKeys.indexOf(shuffle(base).join(''))]++;
    var chiPerm = chiSquareUniform(permCounts, N);
    var critPerm = chiCritical(5);
    printTable('shuffle([1,2,3]) — перестановки', buildRows(permKeys, permCounts, N));
    tests.push({ name: 'shuffle()', chi: chiPerm, critical: critPerm, ok: chiPerm < critPerm });

    // 6) weighted(): веса 50 / 30 / 15 / 4 / 1
    var wItems = ['обычный', 'редкий', 'эпик', 'легенда', 'джекпот'];
    var wWeights = [50, 30, 15, 4, 1];
    var wCounts = [0, 0, 0, 0, 0];
    for (i = 0; i < N; i++) wCounts[wItems.indexOf(weighted(wItems, wWeights))]++;
    var shares = [0.5, 0.3, 0.15, 0.04, 0.01];
    var chiW = 0;
    for (i = 0; i < wCounts.length; i++) {
      var exp = N * shares[i];
      chiW += (wCounts[i] - exp) * (wCounts[i] - exp) / exp;
    }
    var critW = chiCritical(4);
    printTable('weighted — веса 50/30/15/4/1', buildRows(wItems, wCounts, N, shares));
    tests.push({ name: 'weighted()', chi: chiW, critical: critW, ok: chiW < critW });

    // Итоги
    var t1 = (global.performance && performance.now) ? performance.now() : Date.now();
    var allOk = true;
    var summary = [];
    for (i = 0; i < tests.length; i++) {
      if (!tests[i].ok) allOk = false;
      summary.push({
        'Тест': tests[i].name,
        'Хи-квадрат': +tests[i].chi.toFixed(2),
        'Порог (p=0.001)': +tests[i].critical.toFixed(2),
        'Результат': tests[i].ok ? 'OK' : 'ПРОВАЛ'
      });
    }
    printTable('Итоги самотеста', summary);
    console.log('NB.RNG.selfTest: ' + (allOk ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : 'ЕСТЬ ОШИБКИ') +
      ' (' + Math.round(t1 - t0) + ' мс)');

    return { ok: allOk, tests: tests };
  }

  // ---------------------------------------------------------------------
  // Экспорт модуля
  // ---------------------------------------------------------------------
  NB.RNG = {
    int: int,
    float: float,
    pick: pick,
    shuffle: shuffle,
    weighted: weighted,
    selfTest: selfTest
  };

})(typeof window !== 'undefined' ? window : this);