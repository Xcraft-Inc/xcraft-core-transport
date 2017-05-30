'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require ('events');
const escape = require ('escape-regexp');

const ee = {};

class EE {
  constructor (mode, log) {
    this._subs = [];
    this._log = log;
    this._started = false;
    this._connected = false;

    let type;
    if (/^(pub|sub)$/.test (mode)) {
      type = 'pubsub';
    } else if (/^(push|pull)$/.test (mode)) {
      type = 'pushpull';
    } else {
      throw new Error (`unsupported mode (${mode})`);
    }

    if (!ee[type]) {
      ee[type] = new EventEmitter ();
    }
    this._ee = ee[type];
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
      this._ee.on ('message', (...args) => {
        if (!this._started) {
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

    this._ee.on (topic, (...args) => this._started && handler (...args));
    return this;
  }

  send (...args) {
    if (!this._connected) {
      return;
    }
    return this._ee.emit ('message', ...args);
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
    this._connected = true;
    this._ee.emit ('connect');
  }

  start (options, callback) {
    this._started = true;
    callback ();
  }

  stop () {
    this._connected = false;
    this._started = false;
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
