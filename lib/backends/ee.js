'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require ('events');
const xUtils = require ('xcraft-core-utils');

const ee = {};

class EE {
  constructor (mode, log) {
    this._subs = [];
    this._onPending = [];
    this._log = log;

    if (/^(pub|sub)$/.test (mode)) {
      this._type = 'pubsub';
    } else if (/^(push|pull)$/.test (mode)) {
      this._type = 'pushpull';
    } else {
      throw new Error (`unsupported mode (${mode})`);
    }
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

  _onmessage (handler) {
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

  _onclose (handler) {
    this._ee.handle.on ('close', (...args) => {
      if (this._ee.stopped) {
        return;
      }

      this._ee.stopped = true;
      handler (...args);
    });
    return this;
  }

  _ondefault (topic, handler) {
    this._ee.handle.on (
      topic,
      (...args) => !this._ee.stopped && handler (...args)
    );
    return this;
  }

  _create (id) {
    if (!ee[id]) {
      ee[id] = {};
    }

    if (!ee[id][this._type]) {
      ee[id][this._type] = {
        handle: new EventEmitter (),
        stopped: true,
      };
    }

    this._ee = ee[id][this._type];

    this._onPending.forEach (e => this.on (e.topic, e.handler));
    this._onPending = [];
  }

  fixId (oId, nId) {
    ee[nId] = ee[oId];
    delete ee[oId];
  }

  status () {
    return {
      active: !this._stopped,
      subscriptions: this._subs || [],
    };
  }

  on (topic, handler) {
    if (!this._ee) {
      this._onPending.push ({topic, handler});
      return this;
    }

    switch (topic) {
      case 'message': {
        return this._onmessage (handler);
      }

      case 'close': {
        return this._onclose (handler);
      }

      default: {
        return this._ondefault (topic, handler);
      }
    }
  }

  send (topic, ...args) {
    if (this._ee.stopped) {
      return;
    }
    return this._ee.handle.emit ('message', topic, ...args);
  }

  subscribe (re) {
    this._subs.push ((re = EE._toRegExp (re)));
    return re;
  }

  unsubscribe (re) {
    re = EE._toRegExp (re);
    const reS = re.toString ();
    this._subs = this._subs.filter (s => s.toString () !== reS);
  }

  connect (options, callback) {
    this._create (`${options.host}:${options.port}`);
    this._ee.stopped = false;
    this._ee.handle.emit ('connect');
    if (callback) {
      callback ();
    }
  }

  start (options, callback) {
    this._create (`${options.host}:${options.port}`);
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
    return str instanceof RegExp
      ? str
      : new RegExp (xUtils.regex.toAxonRegExpStr (str));
  }
}

module.exports = EE;
