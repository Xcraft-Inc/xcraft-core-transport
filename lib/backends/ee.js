'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require ('events');
const escape = require ('escape-regexp');

const ee = {};

class EE {
  constructor (mode, log) {
    this._subs = [];
    this._log = log;

    if (/^(pub|sub)$/.test (mode)) {
      this._type = 'pubsub';
    } else if (/^(push|pull)$/.test (mode)) {
      this._type = 'pushpull';
    } else {
      throw new Error (`unsupported mode (${mode})`);
    }

    if (!ee[this._type]) {
      ee[this._type] = {
        handle: new EventEmitter (),
        stopped: true,
      };
    }
    this._ee = ee[this._type];
  }

  _hasSubscriptions () {
    return !!this._subs.length;
  }

  _matches (topic) {
    for (var i = 0; i < this._subs.length; ++i) {
      if (this._subs[i].test (topic)) {
        return true;
      }
    }
    return false;
  }

  on (topic, handler) {
    if (topic === 'message') {
      this._ee.handle.on ('message', (...args) => {
        if (this._ee.stopped) {
          return;
        }

        const topic = args[0];
        if (this._hasSubscriptions ()) {
          if (!this._matches (topic)) {
            return;
          }
        }

        handler (...args);
      });
      return this;
    }

    if (topic === 'close') {
      this._ee.handle.on ('close', (...args) => {
        if (this._ee.stopped) {
          return;
        }

        this._ee.stopped = true;
        handler (...args);
      });
      return this;
    }

    this._ee.handle.on (
      topic,
      (...args) => !this._ee.stopped && handler (...args)
    );
    return this;
  }

  send (...args) {
    if (this._ee.stopped) {
      return;
    }
    return this._ee.handle.emit ('message', ...args);
  }

  subscribe (re) {
    this._subs.push ((re = EE._toRegExp (re)));
    return re;
  }

  unsubscribe (re) {
    re = EE._toRegExp (re);
    for (var i = 0; i < this._subs.length; ++i) {
      if (this._subs[i].toString () === re.toString ()) {
        this._subs.splice (i--, 1);
      }
    }
  }

  connect () {
    this._ee.stopped = false;
    this._ee.handle.emit ('connect');
  }

  start (options, callback) {
    this._ee.stopped = false;
    callback ();
  }

  stop () {
    if (this._ee.stopped) {
      return;
    }
    this._ee.handle.emit ('close');
  }

  static _toRegExp (str) {
    if (str instanceof RegExp) {
      return str;
    }
    str = escape (str);
    str = str.replace (/\\\*/g, '(.+)');
    return new RegExp ('^' + str + '$');
  }
}

module.exports = EE;
