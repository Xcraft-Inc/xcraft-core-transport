'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require('events');
const uuidV4 = require('uuid/v4');
const xUtils = require('xcraft-core-utils');
const Cache = require('../cache.js');
const helpers = require('../helpers.js');

const ee = {};

class EE {
  constructor(mode, log) {
    this._cache = new Cache();
    this._subs = {};
    this._subsSize = 0;
    this._onPending = [];
    this._log = log;
    this._events = [];
    this._ee = null;

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
    const h = (...args) => {
      if (this._ee.stopped) {
        return;
      }

      if (this._hasSubscriptions()) {
        const topic = args[0];
        if (!this._cache.matches(topic)) {
          return;
        }
      }

      handler(...args.concat(this._id));
    };

    this._events.push({name: 'message', handler: h});
    this._ee.handle.on('message', h);
    return this;
  }

  _onclose(handler) {
    const h = (id, ...args) => {
      if (this._ee.stopped) {
        return;
      }

      if (this._id !== id) {
        return;
      }

      --this._ee.counter;
      if (this._ee.counter === 0) {
        this._ee.stopped = true;
      }

      handler(...args);
    };

    this._events.push({name: 'close', handler: h});
    this._ee.handle.on('close', h);
    return this;
  }

  _ondefault(topic, handler) {
    const h = (...args) => !this._ee.stopped && handler(...args);

    this._events.push({name: topic, handler: h});
    this._ee.handle.on(topic, h);
    return this;
  }

  _create(key) {
    if (!ee[key]) {
      ee[key] = {};
    }

    if (!ee[key][this._type]) {
      ee[key][this._type] = {
        handle: new EventEmitter(),
        stopped: true,
        counter: 0,
      };
    }

    this._ee = ee[key][this._type];
    this._key = key;
    this._id = uuidV4();

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

  sendTo(port, topic, streamChannel, msg, ...args) {
    if (!this._ee || this._ee.stopped) {
      return;
    }
    msg = helpers.fromXcraftJSON(msg)[0];
    return this._ee.handle.emit('message', topic, msg, ...args);
  }

  send(topic, streamChannel, ...args) {
    return this.sendTo(0, topic, streamChannel, ...args);
  }

  _unsub(id, reS) {
    this._cache.del(id, reS);
    delete this._subs[reS];
    --this._subsSize;
  }

  subscribe(re, ids) {
    const id = ids.length > 1 ? ids[1] : ids[0];

    re = EE._toRegExp(re);
    const reS = re.toString();
    if (!this._subs[reS]) {
      this._cache.set(id, reS, re);
      this._subs[reS] = {
        regex: re,
        unsub: reS => this._unsub(id, reS),
      };
      ++this._subsSize;
    }
    return this._subs[reS].regex;
  }

  unsubscribe(re) {
    re = EE._toRegExp(re);
    const reS = re.toString();
    if (this._subs[reS]) {
      this._subs[reS].unsub(reS);
    }
  }

  unsubscribeAll() {
    for (const sub in this._subs) {
      this._subs[sub].unsub(sub);
    }
  }

  connect(options, callback) {
    this._create(`${options.host}:${options.port}`);
    this._ee.stopped = false;
    ++this._ee.counter;
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
    ++this._ee.counter;
    callback();
  }

  stop() {
    if (!this._ee || this._ee.stopped) {
      return;
    }

    this._ee.handle.emit('close', this._id);
    this.unsubscribeAll();

    for (const event of this._events) {
      this._ee.handle.removeListener(event.name, event.handler);
    }
    this._events = [];

    this._ee = null;
  }

  static _toRegExp(str) {
    return str instanceof RegExp
      ? str
      : new RegExp(xUtils.regex.toAxonRegExpStr(str));
  }
}

module.exports = EE;
