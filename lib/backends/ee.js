'use strict';

const moduleName = 'bus/ee';

const {fromJS, isImmutable} = require('immutable');
const {EventEmitter} = require('events');
const xUtils = require('xcraft-core-utils');

const ee = {};

class EE {
  constructor(mode, log) {
    this._subs = {};
    this._cache = fromJS({});
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
    return this._cache.size > 0;
  }

  _matches(topic, keys, cache = null) {
    keys.push('_');
    const fkey = keys[0];
    while (!cache && keys.length) {
      cache = this._cache.getIn(keys);
      keys.splice(-1, 1);
    }

    if (!cache) {
      return false;
    }

    for (const item of cache.values()) {
      if (isImmutable(item)) {
        const success = this._matches(topic, [], item);
        if (success) {
          return true;
        }
      } else {
        if (item.test(topic)) {
          return true;
        }
      }
    }

    if (fkey !== '_') {
      return this._matches(topic, [], this._cache.delete(fkey));
    }

    return false;
  }

  _onmessage(handler) {
    this._ee.handle.on('message', (...args) => {
      if (this._ee.stopped) {
        return;
      }

      const topic = args[0];
      if (this._hasSubscriptions()) {
        const keys = [];
        const _keys = topic.split('::');
        for (const key of _keys) {
          if (!key.length) {
            break;
          }
          keys.push(key);
        }

        if (!this._matches(topic, keys)) {
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

    this._onPending.forEach(e => this.on(e.topic, e.keys, e.handler));
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

  on(topic, keys, handler) {
    if (!this._ee) {
      this._onPending.push({topic, keys, handler});
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

  subscribe(re, keys) {
    re = EE._toRegExp(re);
    const reS = re.toString();

    if (!this._subs[reS]) {
      if (keys) {
        this._cache = this._cache.setIn(keys.concat(reS), re);
      }

      this._subs[reS] = {
        regex: re,
        keys,
        unsub: () => {
          delete this._subs[reS];
          if (!keys) {
            return;
          }
          this._cache = this._cache.withMutations(cache => {
            let firstPass = true;
            while (keys.length) {
              const {size} = cache.getIn(keys);
              if ((size === 1 && firstPass) || size === 0) {
                cache.deleteIn(keys);
                keys.splice(-1, 1);
                firstPass = false;
                continue;
              }

              if (firstPass) {
                cache.deleteIn(keys.concat(reS));
              }
              break;
            }
          });
        },
      };
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
