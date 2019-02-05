'use strict';

const watt = require('gigawatts');
const path = require('path');

const {extractIds} = require('./helpers.js');
const xUtils = require('xcraft-core-utils');

const arp = {};

class Router {
  constructor(registry, mode, log) {
    const xFs = require('xcraft-core-fs');
    const etc = require('xcraft-core-etc')();
    const config = etc ? etc.load('xcraft-core-transport') : null;

    this._xProbe = require('xcraft-core-probe');

    this._routers = registry;
    this._mode = mode;
    this._log = log;
    this._options = {};
    this._connectedWith = null;

    const backends = path.join(__dirname, 'backends');
    this._backends = new Map();
    xFs
      .ls(backends, /\.js$/)
      .filter(mod =>
        config && config.backends.length
          ? config.backends.indexOf(mod.replace(/\.js$/, '')) !== -1
          : true
      )
      .forEach(mod =>
        this._backends.set(
          mod.replace(/\.js$/, ''),
          new (require(path.join(backends, mod)))(this._mode, log)
        )
      );

    if (mode === 'pull') {
      const routing = (topic, ...args) => {
        switch (topic) {
          case 'message':
            if (args[1].arp) {
              const socket = args[2];
              // XXX: check if already exists in the ARP table
              Object.keys(args[1].arp).forEach(orcName =>
                this._insertRoute(orcName, args[1].arp[orcName], socket)
              );
            }

            /* Is an internal command? */
            if (args[0].startsWith(':')) {
              switch (args[0]) {
                case ':delete-route':
                  Router.deleteRoute(args[1].orcName);
                  break;
              }
            }
            break;
          case 'error':
          case 'close':
          case 'disconnect': {
            const socket = topic === 'error' ? args[1] : args[0];
            this._deleteRoute(socket);
            break;
          }
        }
      };

      this._backends.forEach(backend =>
        backend
          .on('message', (...args) => routing('message', ...args))
          .on('error', (...args) => routing('error', ...args))
          .on('disconnect', (...args) => routing('disconnect', ...args))
      );
    }

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

  _probe(topic, args, handler) {
    if (!this._xProbe.isAvailable()) {
      return handler();
    }

    let id = null;
    if (args && args[0] && args[0]._xcraftMessage) {
      id = args[0].id;
    }

    const end = this._xProbe.push(topic, id);
    const res = handler();
    end();
    return res;
  }

  connectedWith() {
    return this._connectedWith;
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
    this._backends.forEach((backend, name) =>
      this._probe(`${name}/${this._mode}/${topic}`, null, () =>
        backend.on(topic, (...args) => {
          handler(args[0], args[1]);
        })
      )
    );
    return this;
  }

  send(topic, ...args) {
    if (!(this._mode.startsWith('push') || this._mode.startsWith('pub'))) {
      throw new Error(
        `send is only possible with push and pub modes (current is ${
          this._mode
        })`
      );
    }

    let transports = [];
    if (args && args[0] && args[0]._xcraftMessage) {
      transports = args[0].transports;
    }

    if (this._connectedWith) {
      if (transports.indexOf(this._connectedWith) === -1) {
        transports.push(this._connectedWith);
      }

      this._probe(`${this._connectedWith}/${this._mode}/${topic}`, args, () =>
        this._backends.get(this._connectedWith).send(topic, ...args)
      );
      return;
    }

    const switching = topic.endsWith('.finished') || topic.endsWith('.error');

    this._backends.forEach((backend, name) => {
      if (switching && transports.length && transports.indexOf(name) === -1) {
        return;
      }

      // HACK: ensure to send -hydrated events only with ee backend
      if (backend === 'axon' && topic.endsWith('-hydrated')) {
        return;
      }
      // !HACK

      return this._probe(`${name}/${this._mode}/${topic}`, args, () =>
        backend.send(topic, ...args)
      );
    });
  }

  _insertRoute(orcName, token, socket) {
    // arp[orcName] = {token, socket};
  }

  _deleteRoute(socket) {
    /*for (const orcName in arp) {
      if (arp[orcName].socket !== socket) {
        continue;
      }

      Router.deleteRoute(orcName);

      // Inform other servers that for this orc, his fight is over
      Array.from(this._routers)
        .filter(
          router => router.mode === 'push' && router.connectedWith() === 'axon'
        )
        .forEach(router => {
          router.send(`:delete-route`, {orcName});
        });
      break;
    }*/
  }

  static deleteRoute(orcName) {
    delete arp[orcName];
  }

  subscribe(topic, backend) {
    if (this._mode !== 'sub') {
      throw new Error(
        `subscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    const ids = extractIds(topic);
    const regTopic = Router._toRegExp(topic);

    if (backend) {
      this._backends.get(backend).subscribe(regTopic, ids);
      return;
    }
    this._backends.forEach(backend => backend.subscribe(regTopic, ids));
  }

  unsubscribe(topic, backend) {
    if (this._mode !== 'sub') {
      throw new Error(
        `unsubscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    const regTopic = Router._toRegExp(topic);

    if (backend) {
      this._backends.get(backend).unsubscribe(regTopic);
      return;
    }
    this._backends.forEach(backend => backend.unsubscribe(regTopic));
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

    /* Fix id for all backends (it's necessary if axon has changed the port) */
    const nId = `${options.host}${Array.from(this._backends)
      .filter(([, backend]) => !!backend.port)
      .map(([, backend]) => `:${backend.port}`)
      .join('')}`;

    if (id !== nId) {
      this._backends.forEach(backend => backend.fixId(id, nId));
    }
  }

  stop() {
    this._backends.forEach(backend => backend.stop());
  }

  static _toRegExp(str) {
    return str instanceof RegExp
      ? str
      : new RegExp(xUtils.regex.toXcraftRegExpStr(str));
  }
}

module.exports = Router;
