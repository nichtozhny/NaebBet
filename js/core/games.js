(function () {
  'use strict';

  var list = [];

  NB.Games = {
    // Регистрация игры. Если игра с таким id уже есть, она заменяется.
    register: function (game) {
      if (!game || !game.id) {
        console.error('NB.Games.register: у игры нет id', game);
        return;
      }
      var i = list.findIndex(function (g) { return g.id === game.id; });
      if (i >= 0) list[i] = game; else list.push(game);
      if (NB.Events) NB.Events.emit('games:registered', game);
    },

    // Все игры
    getAll: function () {
      return list.slice();
    },

    // Одна игра по id (или null)
    get: function (id) {
      return list.find(function (g) { return g.id === id; }) || null;
    },

    // Игры по категории
    getByCategory: function (category) {
      return list.filter(function (g) { return g.category === category; });
    }
  };
})();