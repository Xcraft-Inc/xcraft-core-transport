'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require('events');
const xUtils = require('xcraft-core-utils');
const {extractIds} = require('../helpers.js');
const Cache = require('../cache.js');

const ee = {};

class EE {
  constructor(mode, log) {
    this._cache = new Cache();
    this._subs = {};
    this._subsSize = 0;
    this._onPending = [];
    this._log = log;

    if (/^(pub|sub)$/.test(mode)) {
      this._type = 'pubsub';
    } else if (/^(push|pull)$/.test(mode)) {
      this._type = 'pushpull';
    } else {
      throw new Error(`unsupported mode (${mode})`);
    }
  }

  _hasSubscriptions() {
    return this._subsSize > 0;
  }

  _onmessage(handler) {
    this._ee.handle.on('message', (...args) => {
      if (this._ee.stopped) {
        return;
      }

      if (this._hasSubscriptions()) {
        const topic = args[0];
        if (!this._cache.matches(topic)) {
          return;
        }
      }

      handler(...args);
    });
    return this;
  }

  _onclose(handler) {
    this._ee.handle.on('close', (...args) => {
      if (this._ee.stopped) {
        return;
      }

      this._ee.stopped = true;
      handler(...args);
    });
    return this;
  }

  _ondefault(topic, handler) {
    this._ee.handle.on(
      topic,
      (...args) => !this._ee.stopped && handler(...args)
    );
    return this;
  }

  _create(id) {
    if (!ee[id]) {
      ee[id] = {};
    }

    if (!ee[id][this._type]) {
      ee[id][this._type] = {
        handle: new EventEmitter(),
        stopped: true,
      };
    }

    this._ee = ee[id][this._type];

    this._onPending.forEach(e => this.on(e.topic, e.handler));
    this._onPending = [];
  }

  fixId(oId, nId) {
    ee[nId] = ee[oId];
    delete ee[oId];
  }

  status() {
    return {
      active: !this._stopped,
      subscriptions: this._subs || {},
    };
  }

  on(topic, handler) {
    if (!this._ee) {
      this._onPending.push({topic, handler});
      return this;
    }

    switch (topic) {
      case 'message': {
        return this._onmessage(handler);
      }

      case 'close': {
        return this._onclose(handler);
      }

      default: {
        return this._ondefault(topic, handler);
      }
    }
  }

  send(topic, ...args) {
    if (this._ee.stopped) {
      return;
    }
    return this._ee.handle.emit('message', topic, ...args);
  }

  subscribe(re, ids) {
    const id = ids.length > 1 ? ids[1] : ids[0];

    re = EE._toRegExp(re);
    const reS = re.toString();
    if (!this._subs[reS]) {
      this._cache.set(id, reS, re);
      this._subs[reS] = {
        regex: re,
        unsub: () => {
          this._cache.del(id, reS);
          delete this._subs[reS];
          --this._subsSize;
        },
      };
      ++this._subsSize;
    }
    return this._subs[reS].regex;
  }

  unsubscribe(re) {
    re = EE._toRegExp(re);
    const reS = re.toString();
    this._subs[reS].unsub();
  }

  connect(options, callback) {
    this._create(`${options.host}:${options.port}`);
    this._ee.stopped = false;
    this._ee.handle.emit('connect');
    if (callback) {
      callback();
    }
  }

  start(options, callback) {
    if (this._ee && !this._ee.stopped) {
      callback();
      return;
    }

    this._create(`${options.host}:${options.port}`);
    this._ee.stopped = false;
    callback();
  }

  stop() {
    if (this._ee.stopped) {
      return;
    }
    this._ee.handle.emit('close');
  }

  static _toRegExp(str) {
    return str instanceof RegExp
      ? str
      : new RegExp(xUtils.regex.toAxonRegExpStr(str));
  }
}

module.exports = EE;
