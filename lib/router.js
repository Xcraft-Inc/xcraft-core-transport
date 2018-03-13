'use strict';

const watt = require('watt');
const path = require('path');

const xUtils = require('xcraft-core-utils');

class Router {
  constructor(mode, log) {
    const xFs = require('xcraft-core-fs');
    const config = require('xcraft-core-etc')().load('xcraft-core-transport');

    this._mode = mode;
    this._log = log;
    this._options = {};
    this._connectedWith = null;

    const backends = path.join(__dirname, 'backends');
    this._backends = new Map();
    xFs
      .ls(backends, /\.js$/)
      .filter(
        mod =>
          config.backends.length
            ? config.backends.indexOf(mod.replace(/\.js$/, '')) !== -1
            : mod
      )
      .forEach(mod =>
        this._backends.set(
          mod.replace(/\.js$/, ''),
          new (require(path.join(backends, mod)))(this._mode, log)
        )
      );

    watt.wrapAll(this, '_start');
  }

  get options() {
    return this._options;
  }

  get mode() {
    return this._mode;
  }

  get ports() {
    const ports = [];
    this._backends.forEach(backend => {
      if (backend.port) {
        ports.push(backend.port);
      }
    });
    return ports;
  }

  status() {
    const backends = {};
    this._backends.forEach(
      (backend, name) => (backends[name] = backend.status())
    );
    return {
      backends,
      options: this._options,
      mode: this._mode,
      connectedWith: this._connectedWith,
    };
  }

  on(topic, handler) {
    this._backends.forEach(backend => backend.on(topic, handler));
    return this;
  }

  send(topic, ...args) {
    if (!/^(push|pub)$/.test(this._mode)) {
      throw new Error(
        `send is only possible with push and pub modes (current is ${
          this._mode
        })`
      );
    }

    if (this._connectedWith) {
      this._backends.get(this._connectedWith).send(topic, ...args);
      return;
    }
    this._backends.forEach(backend => backend.send(topic, ...args));
  }

  subscribe(topic) {
    if (this._mode !== 'sub') {
      throw new Error(
        `subscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    this._backends.forEach(backend =>
      backend.subscribe(Router._toRegExp(topic))
    );
  }

  unsubscribe(topic) {
    if (this._mode !== 'sub') {
      throw new Error(
        `unsubscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    this._backends.forEach(backend =>
      backend.unsubscribe(Router._toRegExp(topic))
    );
  }

  connect(backend, options, callback) {
    if (!this._backends.has(backend)) {
      throw new Error(`backend ${backend} not supported`);
    }
    this._connectedWith = backend;
    this._backends.get(backend).connect(options, callback);
  }

  start(options, callback) {
    this._options = options;
    this._start(options, callback);
  }

  *_start(options, next) {
    const id = `${options.host}:${options.port}`;

    this._backends.forEach(backend => backend.start(options, next.parallel()));
    yield next.sync();

    /* Fix id for all backends (it's necessary of axon has changed the port) */
    const nId = `${options.host}${Array.from(this._backends)
      .filter(([_, backend]) => !!backend.port)
      .map(([_, backend]) => `:${backend.port}`)
      .join('')}`;

    if (id !== nId) {
      this._backends.forEach(backend => backend.fixId(id, nId));
    }
  }

  stop() {
    if (this._connectedWith) {
      this._backends.get(this._connectedWith).stop();
      return;
    }
    this._backends.forEach(backend => backend.stop());
  }

  static _toRegExp(str) {
    return str instanceof RegExp
      ? str
      : new RegExp(xUtils.regex.toXcraftRegExpStr(str));
  }
}

module.exports = Router;