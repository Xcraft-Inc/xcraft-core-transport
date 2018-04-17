'use strict';

const Router = require('./router.js');
const Cache = require('./cache.js');
const helpers = require('./helpers.js');

const registry = new Set();

class WrappedRouter extends Router {
  constructor(...args) {
    super(...args);
    registry.add(this);
  }

  stop(...args) {
    super.stop(...args);
    registry.delete(this);
  }
}

module.exports = {
  helpers,
  Cache,
  Router: WrappedRouter,
  getRouters: () => {
    const list = [];
    registry.forEach(it => list.push(it));
    return list;
  },
};
