'use strict';

const watt = require('gigawatts');
const path = require('path');
const net = require('net');
const {merge} = require('lodash');
const {EventEmitter} = require('events');

const {extractIds, extractLineId} = require('./helpers.js');
const Streamer = require('./streamer.js');
const xUtils = require('xcraft-core-utils');

const arp = {
  ee: {
    greathall: {
      id: 'greathall',
    },
  },
  axon: {},
};
let routers = {};

class Router {
  constructor(id, mode, log, acceptIncoming) {
    this._e = new EventEmitter();

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
          new (require(path.join(backends, mod)))(
            this._mode,
            log,
            acceptIncoming
          )
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
                  Router.deleteRoute(
                    args[1].orcName,
                    args[2] instanceof net.Socket ? 'axon' : 'ee'
                  );
                  this._e.emit('delete-orc', args[1].orcName);
                  break;
                case ':conn-line':
                  Router.connectLine(
                    args[1].lineId,
                    args[1].orcName,
                    args[1].routerId
                  );
                  break;
                case ':disconn-line':
                  Router.disconnectLine(
                    args[1].lineId,
                    args[1].orcName,
                    args[1].routerId
                  );
                  break;
              }
              return;
            }

            if (!args[1]._xcraftMessage) {
              break;
            }

            const socket = args[2];
            args[1].router = socket instanceof net.Socket ? 'axon' : 'ee';

            if (args[1].arp && !args[1].forwarding) {
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
    } else if (mode === 'pub') {
      this._backends.forEach((backend) =>
        backend
          .on('error', (err, remotePort) => {
            this._log.warn(
              `socket error (remote port: ${remotePort}): ${
                err.stack || err.message || err
              }`
            );

            if (!remotePort) {
              return;
            }

            const arpEntry = Object.entries(arp[backend.name]).find(
              ([, entry]) => entry.port === remotePort
            );
            if (!arpEntry) {
              return;
            }

            /* The remote socket ("pub" side) is dead, then the "push" socket
             * used by the same client must be destroyed too.
             */
            const [, entry] = arpEntry;
            entry.socket.destroy();
            /* It's maybe a bit strange that with a broken connection on the
             * events bus, the command bus detects nothing. Here I will explain
             * how it works. When a client is connected, it uses two topologies,
             * push/pull for the commands and pub/sub for the events. Events
             * are sent often and when a socket is dead, it's detected very
             * early then it's destroyed on the server side. But about the
             * command socket it's very different because the server uses this
             * one only for listening. While nobody write in the socket, nothing
             * happens. Even if the client is no longer available (bad Internet
             * connection for example) the server consider that this socket is
             * valid (you must use a socket to see that this socket is dead,
             * otherwise it leaks).
             */
          })
          .on('close', (sock) => {
            this._log.dbg(
              `event bus client closed, remote port: ${sock.remotePort}`
            );
          })
          .on('disconnect', (sock) => {
            this._log.dbg(
              `event bus client disconnected, remote port: ${sock.remotePort}`
            );
          })
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

  onInsertOrc(handler) {
    this._e.on('insert-orc', handler);
    return this;
  }

  onDeleteOrc(handler) {
    this._e.on('delete-orc', handler);
    return this;
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
          const orcName =
            topic === 'autoconnect' && msg.orcName === 'greathall'
              ? msg.data.autoConnectToken
              : msg.orcName;
          if (sub._backends.get(sub.connectedWith())._sock.socks.length === 0) {
            throw new Error(`Axon socket lost (server is down?)`);
          }

          msg.arp[orcName].port = sub._backends.get(
            sub.connectedWith()
          )._sock.socks[0].localPort;

          let xHorde;
          try {
            xHorde = require('xcraft-core-horde');
          } catch (ex) {
            if (ex.code !== 'MODULE_NOT_FOUND') {
              throw ex;
            }
          }

          if (xHorde) {
            msg.arp[orcName].hordes = xHorde.getSlaves();
          }
        }
      }

      this._probe(`${this._connectedWith}/${this._mode}/${topic}`, args, () =>
        this._backends
          .get(this._connectedWith)
          .send(topic, this._streamChannel, ...args)
      );
      return;
    }

    const msg = args && args[0];

    /* Routing */
    let arpEntries = [];

    if (topic.endsWith('.finished') || topic.endsWith('.error')) {
      if (!msg.forwarding) {
        const orcName = topic.substr(0, topic.indexOf('::'));
        for (const backend in arp) {
          if (arp[backend][orcName]) {
            arpEntries.push({
              orcName,
              entry: arp[backend][orcName],
              router: null,
            });
          }
        }
      } else {
        for (const backend in arp) {
          const entry = Object.entries(arp[backend]).find(
            ([, entry]) =>
              entry.hordes && entry.hordes.includes(msg.forwarding.appId)
          );
          if (entry) {
            arpEntries.push({
              orcName: entry[0],
              entry: entry[1],
              router: null,
            });
          }
        }
        if (arpEntries.length === 0) {
          throw new Error(
            `missing entry in ARP table for ${msg.forwarding.appId}`
          );
        }
      }
    }

    let skipBroadcast = false;

    if (arpEntries.length === 0) {
      const lineId = extractLineId(topic);
      if (lineId) {
        for (const backend in arp) {
          const entries = Object.keys(arp[backend])
            .filter(
              (orcName) =>
                !!arp[backend][orcName].lines &&
                !!arp[backend][orcName].lines[lineId]
            )
            .map((orcName) => {
              return {
                orcName,
                entry: arp[backend][orcName],
                router:
                  arp[backend][orcName].socket instanceof net.Socket
                    ? 'axon'
                    : 'ee',
              };
            });
          arpEntries = arpEntries.concat(entries);
        }

        skipBroadcast = true;
      }
    }

    if (arpEntries.length > 0) {
      const xBus = require('xcraft-core-bus');
      const sentFor = new Map();

      for (const {orcName, entry, router} of arpEntries) {
        const {id, port} = entry;
        if (id !== this._id) {
          const router = routers[id].pub;
          router.send(topic, ...args);
          continue;
        }

        let msgToken;
        const at = orcName.indexOf('@');
        if (at >= 0) {
          msgToken = orcName.substr(at + 1);
        }

        if (!msgToken) {
          if (orcName === 'greathall') {
            msgToken = xBus.getToken();
            /* With the global busClient, no routing is set... because it's not an usual resp */
            args[0].originRouter = 'ee';
          } else {
            throw new Error(
              `unexpected error where an orcName (${orcName}) exists without bus token`
            );
          }
        }

        let routerKey = 'router';
        if (!msg.forwarding && msgToken === xBus.getToken()) {
          routerKey = 'originRouter';
        } else if (router) {
          args[0].router = router;
        }

        const backendName =
          args && args[0] && args[0]._xcraftMessage && args[0][routerKey];
        const backend = this._backends.get(backendName);

        /* Do not send the same msg to the same backend/port (see sentFor)
         * It happens when multiple orcs shared the same event emitter.
         */
        if (
          backend &&
          (!sentFor.has(backend) || sentFor.get(backend) !== port)
        ) {
          sentFor.set(backend, port);
          this._probe(`${backendName}/${this._mode}/${topic}`, args, () =>
            port
              ? backend.sendTo(port, topic, this._streamChannel, ...args)
              : backend.send(topic, this._streamChannel, ...args)
          );
          skipBroadcast = true;
        }
      }
    }

    if (skipBroadcast) {
      return;
    }

    /* Broadcast to all backends because this orcName is not known */
    this._backends.forEach((backend, name) => {
      return this._probe(`${name}/${this._mode}/${topic}`, args, () =>
        backend.send(topic, this._streamChannel, ...args)
      );
    });
  }

  _insertRoute(id, orcName, entry, socket) {
    const {token, port, hordes, nice} = entry;

    let backend, _backend;
    if (socket instanceof net.Socket) {
      backend = 'axon';
      _backend = 'ee';
    } else {
      backend = 'ee';
      _backend = 'axon';
    }

    /* We use the same lines object reference in both backend, then when the
     * first changes, the second changes too.
     */

    let lines = {};
    if (!arp[backend][orcName]) {
      if (arp[_backend][orcName] && arp[_backend][orcName].lines) {
        /* Retrieve lines object from the second backend */
        lines = arp[_backend][orcName].lines;
      }
    }

    const insertOrc = !arp[backend][orcName];

    arp[backend][orcName] = merge(arp[backend][orcName] || {lines}, {
      id,
      token,
      socket,
      port,
      hordes,
    });

    if (nice !== undefined) {
      arp[backend][orcName].nice = nice;
      if (arp[_backend][orcName]) {
        arp[_backend][orcName].nice = nice;
      }
    }

    if (insertOrc) {
      this._e.emit('insert-orc', orcName);
    }
  }

  _deleteRoute(socket) {
    for (const backend in arp) {
      for (const orcName in arp[backend]) {
        if (arp[backend][orcName].socket !== socket) {
          continue;
        }

        Router.deleteRoute(orcName, backend);
        this._e.emit('delete-orc', orcName);

        Object.values(routers)
          .filter(
            (router) => router.push && router.push.connectedWith() === 'axon'
          )
          .map((router) => router.push)
          .forEach((router) => {
            router.send(`:delete-route`, {orcName});
          });
      }
    }
  }

  static deleteRoute(orcName, backend) {
    delete arp[backend][orcName];
    if (backend === 'axon') {
      delete arp.ee[orcName];
    }
  }

  static connectLine(lineId, orcName, routerId) {
    let exit = true;
    let lines = {};

    for (const backend in arp) {
      if (!arp[backend][orcName]) {
        continue;
      }

      if (!arp[backend][orcName].lines) {
        arp[backend][orcName].lines = lines;
      }

      if (arp[backend][orcName].lines[lineId]) {
        ++arp[backend][orcName].lines[lineId];
        continue;
      }

      arp[backend][orcName].lines[lineId] = 1;
      exit = false;
    }

    if (exit || orcName === 'greathall') {
      return;
    }

    Object.values(routers)
      .filter(
        (router) =>
          router.push &&
          router.push.connectedWith() === 'axon' &&
          router.push.id !== routerId
      )
      .map((router) => router.push)
      .forEach((router) => {
        router.send(`:conn-line`, {lineId, orcName, routerId: router.id});
      });
  }

  static disconnectLine(lineId, orcName, routerId) {
    let exit = true;

    for (const backend in arp) {
      if (!arp[backend][orcName] || !arp[backend][orcName].lines) {
        continue;
      }

      if (!arp[backend][orcName].lines[lineId]) {
        continue;
      }

      --arp[backend][orcName].lines[lineId];

      if (arp[backend][orcName].lines[lineId] > 0) {
        continue;
      }

      delete arp[backend][orcName].lines[lineId];
      exit = false;
    }

    if (exit) {
      return;
    }

    Object.values(routers)
      .filter(
        (router) =>
          router.push &&
          router.push.connectedWith() === 'axon' &&
          router.push.id !== routerId
      )
      .map((router) => router.push)
      .forEach((router) => {
        router.send(`:disconn-line`, {lineId, orcName, routerId: router.id});
      });
  }

  /* Move the route which was used for the autoconnect stuff.
   * We can retrieve the original token id by splitting the
   * definitive orc name. The old orc name was using the
   * temporary id only used with the autoconnect.
   *
   * This API is very specific and must be used only with
   * autoconnect.
   */
  static moveRoute(oldOrcName, newOrcName) {
    for (const backend in arp) {
      if (!arp[backend][oldOrcName]) {
        continue;
      }

      arp[backend][newOrcName] = arp[backend][oldOrcName];
      if (!arp[backend][newOrcName].token) {
        arp[backend][newOrcName].token = newOrcName.split('@')[1];
      }

      Router.deleteRoute(oldOrcName, backend);
    }
  }

  static getRoute(orcName, backend) {
    return arp[backend][orcName];
  }

  static setRoutersRegistry(registry) {
    routers = registry;
  }

  static getRouters(orcName, backend) {
    const route = Router.getRoute(orcName, backend);
    return route ? routers[route.id] : null;
  }

  static getARP() {
    return arp;
  }

  static getNice(orcName, backend) {
    return arp[backend] && arp[backend][orcName]
      ? arp[backend][orcName].nice
      : 0;
  }

  subscribe(topic, backend, orcName) {
    if (this._mode !== 'sub') {
      throw new Error(
        `subscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    const ids = extractIds(topic);
    const regTopic = Router._toRegExp(topic);

    if (orcName) {
      const lineId = extractLineId(topic);
      if (lineId) {
        const {id} = routers[this._id].push;
        Router.connectLine(lineId, orcName, id);
      }

      if (!backend && orcName === 'greathall') {
        backend = 'ee';
      }
    }

    if (backend) {
      this._backends.get(backend).subscribe(regTopic, ids);
    } else {
      this._backends.forEach((backend) => backend.subscribe(regTopic, ids));
    }
  }

  unsubscribe(topic, backend, orcName) {
    if (this._mode !== 'sub') {
      throw new Error(
        `unsubscribe is only possible with sub mode (current is ${this._mode})`
      );
    }

    const regTopic = Router._toRegExp(topic);

    if (backend) {
      this._backends.get(backend).unsubscribe(regTopic);
    } else {
      this._backends.forEach((backend) => backend.unsubscribe(regTopic));
    }

    if (orcName) {
      const lineId = extractLineId(topic);
      if (lineId) {
        const {id} = routers[this._id].push;
        Router.disconnectLine(lineId, orcName, id);
      }
    }
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

  acceptIncoming() {
    this._backends.forEach((backend) => backend.acceptIncoming());
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
