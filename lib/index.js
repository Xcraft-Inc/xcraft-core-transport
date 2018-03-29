'use strict';

const Router = require('./router.js');
const Cache = require('./cache.js');
const helpers = require('./helpers.js');

const weakRegistry = new WeakMap();
const registry = new Set();

class WrappedRouter extends Router {
  constructor(...args) {
    super(...args);
    const it = {};
    weakRegistry.set(it, this);
    registry.add(it);
  }
}

module.exports = {
  extractIds: helpers.extractIds,
  Cache,
  Router: WrappedRouter,
  getRouters: () => {
    const list = [];
    registry.forEach(it => {
      const ptr = weakRegistry.get(it);
      if (ptr) {
        list.push(ptr);
      }
    });
    return list;
  },
};
