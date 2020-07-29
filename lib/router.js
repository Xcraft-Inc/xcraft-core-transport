'use strict';

const watt = require('gigawatts');
const path = require('path');
const net = require('net');

const {extractIds} = require('./helpers.js');
const Streamer = require('./streamer.js');
const xUtils = require('xcraft-core-utils');

const arp = {};
let routers = {};

class Router {
  constructor(id, mode, log) {
    this._streamChannel = this._streamChannel.bind(this);

    const xFs = require('xcraft-core-fs');
    const etc = require('xcraft-core-etc')();
    const config = etc ? etc.load('xcraft-core-transport') : null;

    this._xProbe = require('xcraft-core-probe');

    this._id = id;
    this._mode = mode;
    this._log = log;
    this._options = {};
    this._connectedWith = null;
    this._hooks = {};

    const backends = path.join(__dirname, 'backends');
    this._backends = new Map();
    xFs
      .ls(backends, /\.js$/)
      .filter((mod) =>
        config && config.backends.length
          ? config.backends.indexOf(mod.replace(/\.js$/, '')) !== -1
          : true
      )
      .forEach((mod) =>
        this._backends.set(
          mod.replace(/\.js$/, ''),
          new (require(path.join(backends, mod)))(this._mode, log)
        )
      );

    if (mode === 'pull') {
      const routing = (topic, ...args) => {
        switch (topic) {
          case 'message': {
            /* Is an internal command? */
            if (args[0].startsWith(':')) {
              switch (args[0]) {
                case ':delete-route':
                  Router.deleteRoute(args[1].orcName);
                  break;
              }
              break;
            }

            if (!args[1]._xcraftMessage) {
              break;
            }

            const socket = args[2];
            args[1].router = socket instanceof net.Socket ? 'axon' : 'ee';

            if (args[1].arp) {
              Object.keys(args[1].arp).forEach((orcName) =>
                this._insertRoute(id, orcName, args[1].arp[orcName], socket)
              );
            }
            break;
          }
          case 'error':
          case 'close':
          case 'disconnect': {
            const socket = topic === 'error' ? args[1] : args[0];
            this._deleteRoute(socket);
            break;
          }
        }

        if (this._hooks[topic]) {
          this._hooks[topic](...args);
        }
      };

      this._backends.forEach((backend) =>
        backend
          .on(
            'message',
            (...args) => routing('message', ...args),
            this._streamChannel
          )
          .on(
            'error', //
            (...args) => routing('error', ...args),
            this._streamChannel
          )
          .on(
            'disconnect',
            (...args) => routing('disconnect', ...args),
            this._streamChannel
          )
      );
    }

    watt.wrapAll(this, '_start');
  }

  get id() {
    return this._id;
  }

  get options() {
    return this._options;
  }

  get mode() {
    return this._mode;
  }

  get ports() {
    const ports = [];
    this._backends.forEach((backend) => {
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

  _streamChannel(info) {
    if (!info.streamId) {
      return {
        getStream: () => info.stream,
        streamer: (appId, stream, progress, next) => {
          stream.on('finish', () => next());
          info.stream.pipe(stream);
        },
        getMultiStreams: () => {
          const tar = require('tar-stream');
          return tar.extract();
        },
      };
    }

    if (info.stream) {
      new Streamer(info.streamId, info.stream, info.isUpload);
      return {
        streamId: info.streamId,
      };
    }
    return {
      streamId: info.streamId,
      streamer: (...args) => {
        const streamer = new Streamer(info.streamId);
        streamer.receive(...args);
      },
    };
  }

  hook(topic, handler) {
    this._hooks[topic] = handler;
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
        backend.on(
          topic,
          (...args) => {
            handler(args[0], args[1]);
          },
          this._streamChannel
        )
      )
    );
    return this;
  }

  send(topic, ...args) {
    if (!(this._mode.startsWith('push') || this._mode.startsWith('pub'))) {
      throw new Error(
        `send is only possible with push and pub modes (current is ${this._mode})`
      );
    }

    if (this._connectedWith) {
      /* Inject the sub socket localPort when an ARP entry is provided
       * with Axon
       */
      const msg = args[0];
      if (msg && msg.arp && this._connectedWith === 'axon') {
        if (routers[this.id] && routers[this.id].sub) {
          const sub = routers[this.id].sub;
          const orcName = msg.orcName === 'greathall' ? msg.data : msg.orcName;
          msg.arp[orcName].port = sub._backends.get(
            sub.connectedWith()
          )._sock.socks[0].localPort;
        }
      }

      this._probe(`${this._connectedWith}/${this._mode}/${topic}`, args, () =>
        this._backends
          .get(this._connectedWith)
          .send(topic, this._streamChannel, ...args)
      );
      return;
    }

    /* Routing */
    const isUnicast = topic.endsWith('.finished') || topic.endsWith('.error');

    if (isUnicast) {
      const orcName = topic.substr(0, topic.indexOf('::'));
      if (arp[orcName]) {
        const {id, port} = arp[orcName];
        if (id !== this._id) {
          const router = routers[id].pub;
          router.send(topic, ...args);
          return;
        }

        const msgToken = orcName.split('@')[1];
        let routerKey = 'router';
        const xBus = require('xcraft-core-bus');
        if (msgToken === xBus.getToken()) {
          routerKey = 'originRouter';
        }

        /* Use this instance */
        const backendName =
          args && args[0] && args[0]._xcraftMessage && args[0][routerKey];
        const backend = this._backends.get(backendName);
        this._probe(`${backendName}/${this._mode}/${topic}`, args, () =>
          port
            ? backend.sendTo(port, topic, this._streamChannel, ...args)
            : backend.send(topic, this._streamChannel, ...args)
        );
        return;
      }
    }

    /* Broadcast to all backends because this orcName is not known */
    this._backends.forEach((backend, name) => {
      // HACK: ensure to send -hydrated events only with ee backend
      if (name === 'axon') {
        if (
          topic.endsWith('-hydrated') ||
          topic.endsWith('drill-down-requested') ||
          topic.endsWith('job-queue.sampled')
        ) {
          return;
        }
      }
      // !HACK

      return this._probe(`${name}/${this._mode}/${topic}`, args, () =>
        backend.send(topic, this._streamChannel, ...args)
      );
    });
  }

  _insertRoute(id, orcName, entry, socket) {
    const {token, port} = entry;
    arp[orcName] = Object.assign(arp[orcName] || {}, {
      id,
      token,
      socket,
      port,
    });
  }

  _deleteRoute(socket) {
    for (const orcName in arp) {
      if (arp[orcName].socket !== socket) {
        continue;
      }

      Router.deleteRoute(orcName);

      Object.values(routers)
        .filter(
          (router) => router.push && router.push.connectedWith() === 'axon'
        )
        .map((router) => router.push)
        .forEach((router) => {
          router.send(`:delete-route`, {orcName});
        });
      break;
    }
  }

  static deleteRoute(orcName) {
    delete arp[orcName];
  }

  static getRoute(orcName) {
    return arp[orcName];
  }

  static setRoutersRegistry(registry) {
    routers = registry;
  }

  static getRouters(orcName) {
    const route = Router.getRoute(orcName);
    return route ? routers[route.id] : null;
  }

  static getARP() {
    return arp;
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
    this._backends.forEach((backend) => backend.subscribe(regTopic, ids));
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
    this._backends.forEach((backend) => backend.unsubscribe(regTopic));
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

    this._backends.forEach((backend) =>
      backend.start(options, next.parallel())
    );
    yield next.sync();

    /* Fix id for all backends (it's necessary if axon has changed the port) */
    const nId = `${options.host}${Array.from(this._backends)
      .filter(([, backend]) => !!backend.port)
      .map(([, backend]) => `:${backend.port}`)
      .join('')}`;

    if (id !== nId) {
      this._backends.forEach((backend) => backend.fixId(id, nId));
    }
  }

  stop() {
    this._backends.forEach((backend) => backend.stop());
  }

  static _toRegExp(str) {
    return str instanceof RegExp
      ? str
      : new RegExp(xUtils.regex.toXcraftRegExpStr(str));
  }
}

module.exports = Router;
