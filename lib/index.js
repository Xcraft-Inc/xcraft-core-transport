'use strict';

const Router = require('./router.js');
const Cache = require('./cache.js');
const helpers = require('./helpers.js');

const registry = {};

Router.setRoutersRegistry(registry);

class WrappedRouter extends Router {
  constructor(id, mode, ...args) {
    super(id, mode, ...args);
    if (!registry[id]) {
      registry[id] = {};
    }
    registry[id][mode] = this;
  }

  stop(...args) {
    super.stop(...args);
    delete registry[this.id][this.mode];
    if (!Object.keys(registry[this.id]).length) {
      delete registry[this.id];
    }
  }
}

module.exports = {
  helpers,
  Cache,
  Router: WrappedRouter,
  getRouters: () => {
    let list = [];
    Object.values(registry)
      .map((it) => Object.values(it))
      .forEach((routers) => (list = list.concat(routers)));
    return list;
  },
};
