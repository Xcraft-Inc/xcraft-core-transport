'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require ('events');
const escape = require ('escape-regexp');

const ee = new EventEmitter ();

class EE {
  constructor (mode, log) {
    this._subs = [];
    this._log = log;
    this._ee = ee;
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
    // TODO: save the handlers

    // this._ee.on (topic, (...args) => {
    //   console.log (`EE: ${args}`);
    //   handler (...args);
    // });
    return this;
  }

  send (...args) {
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
    this._ee.on ('message', (...args) => {
      if (this._hasSubscriptions ()) {
        const topic = args[0];
        if (!this._matches (topic)) {
          return;
        }
      }

      // this._ee.emit (['message'].concat (args));

      // TODO: call the handlers saved by on() method
    });
  }

  start (options, callback) {
    callback ();
  }

  stop () {}

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
