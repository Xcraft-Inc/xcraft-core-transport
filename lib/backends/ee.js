'use strict';

const moduleName = 'bus/ee';

const {EventEmitter} = require ('events');

class EE {
  constructor (mode, log) {
    this._log = log;
    this._ee = new EventEmitter ();
  }

  on (...args) {
    this._ee.on (...args);
    return this;
  }

  send (...args) {
    return this._ee.emit (...args);
  }

  subscribe (...args) {}

  unsubscribe (...args) {}

  connect (...args) {}

  start (options, callback) {
    callback ();
  }

  stop () {}
}

module.exports = EE;
