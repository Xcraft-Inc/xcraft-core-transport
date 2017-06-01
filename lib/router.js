'use strict';

const watt = require ('watt');
const path = require ('path');

class Router {
  constructor (mode, log) {
    const xFs = require ('xcraft-core-fs');

    this._mode = mode;
    this._log = log;
    this._options = {};
    this._connectedWith = null;

    const backends = path.join (__dirname, 'backends');

    this._backends = new Map ();
    xFs
      .ls (backends, /\.js$/)
      .forEach (mod =>
        this._backends.set (
          mod.replace (/\.js$/, ''),
          new (require (path.join (backends, mod))) (this._mode, log)
        )
      );

    watt.wrapAll (this, '_start');
  }

  get options () {
    return this._options;
  }

  get mode () {
    return this._mode;
  }

  on (topic, handler) {
    this._backends.forEach (backend => backend.on (topic, handler));
    return this;
  }

  send (...args) {
    if (!/^(push|pub)$/.test (this._mode)) {
      throw new Error (
        `send is only possible with push and pub modes (current is ${this._mode})`
      );
    }

    if (this._connectedWith) {
      this._backends.get (this._connectedWith).send (...args);
      return;
    }
    this._backends.forEach (backend => backend.send (...args));
  }

  subscribe (...args) {
    if (this._mode !== 'sub') {
      throw new Error (
        `subscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    this._backends.forEach (backend => backend.subscribe (...args));
  }

  unsubscribe (...args) {
    if (this._mode !== 'sub') {
      throw new Error (
        `unsubscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    this._backends.forEach (backend => backend.unsubscribe (...args));
  }

  connect (backend, ...args) {
    if (!this._backends.has (backend)) {
      throw new Error (`backend ${backend} not supported`);
    }
    this._connectedWith = backend;
    this._backends.get (backend).connect (...args);
  }

  start (options, callback) {
    this._options = options;
    this._start (options, callback);
  }

  *_start (options, next) {
    this._backends.forEach (backend =>
      backend.start (options, next.parallel ())
    );
    yield next.sync ();
  }

  stop () {
    if (this._connectedWith) {
      this._backends.get (this._connectedWith).stop ();
      return;
    }
    this._backends.forEach (backend => backend.stop ());
  }
}

module.exports = Router;
