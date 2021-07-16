'use strict';

const moduleName = 'bus/axon';

const axon = require('xcraft-axon');
const helpers = require('../helpers.js');
class Axon {
  constructor(mode, log, acceptIncoming = true) {
    this._role = mode === 'push' || mode === 'pull' ? 'cmd' : 'evt';
    this._closed = true;
    this._host = '';
    this._port = 0;
    this._useUnixSocket = false;
    this._unixSocketPath = '/tmp';
    this._log = log;
    this._events = [];
    this._acceptIncoming = acceptIncoming;
    this._connectStack = [];

    const h = (err) => {
      const xLog = require('xcraft-core-log')(moduleName, null);
      xLog.err(err);
    };

    this._events.push({name: 'error', handler: h});
    this._sock = axon.socket(mode).on('error', h);
    this._sock.set('retry max timeout', 1000);
  }

  get name() {
    return 'axon';
  }

  get subsSize() {
    return this._sock._subscriptionsSize || 0;
  }

  get port() {
    return this._port;
  }

  get socketId() {
    return this._unixSocketId
      ? `${this._unixSocketId}${this._port}`
      : this._port;
  }

  get bindingUri() {
    if (this._useUnixSocket) {
      return `unix://${this._unixSocketPath}/${this.socketId}-${this._role}.sock`;
    } else {
      return `tcp://${this._host}:${this._port}`;
    }
  }

  get lastPerf() {
    if (this._role !== 'evt') {
      return -1;
    }

    if (this._sock.socks.length !== 1) {
      return -1;
    }

    return this._sock.socks[0][axon.symbols.Perf]();
  }

  _bind(callback) {
    this._sock.set('retry timeout', 1000);
    this._sock.set('socket timeout', this._timeout);
    this._sock.bind(this.bindingUri, (err) => {
      if (!err) {
        this._log.verb('bus started on %s:%d', this._host, this._port);
      }
      callback(err);
    });
  }

  fixId(oId, nId) {}

  acceptIncoming() {
    this._acceptIncoming = true;
    this._connectStack.forEach(({handler, data}) => handler(...data));
    this._connectStack = [];
  }

  status() {
    return {
      host: this._host,
      port: this._port,
      active: !this._closed,
      subscriptions: this._sock.subscriptions || {},
    };
  }

  on(topic, handler, streamChannel) {
    if (topic === 'error') {
      topic = 'socket error'; /* Ensure to catch all possible errors */
    }

    const h = (...args) => {
      let data = args;
      if (topic === 'message') {
        if (this._sock.socks.length === 0) {
          return;
        }

        data = helpers.fromXcraftJSON(args, (streamId) =>
          streamChannel({streamId})
        );

        if (!this._acceptIncoming && args[0] === 'autoconnect') {
          this._connectStack.push({handler, data});
          return;
        }
      }

      return handler(...data);
    };

    this._events.push({name: topic, handler: h});
    this._sock.on(topic, h);
    return this;
  }

  sendTo(port, topic, streamChannel, ...args) {
    if (this._closed) {
      return;
    }

    if (this._sock.socks.length === 0) {
      return;
    }

    const data = helpers.toXcraftJSON(args, (streamId, stream, isUpload) =>
      streamChannel({streamId, stream, isUpload})
    );

    if (port) {
      /* Search the right socket or send to all sockets */
      for (const sock of this._sock.socks) {
        if (sock.remotePort === port) {
          data.push(sock);
          break;
        }
      }
    }

    return this._sock.send(topic, ...data);
  }

  send(topic, streamChannel, ...args) {
    return this.sendTo(0, topic, streamChannel, ...args);
  }

  subscribe(re, ids) {
    return this._sock.subscribe(re, ids);
  }

  unsubscribe(re) {
    return this._sock.unsubscribe(re);
  }

  unsubscribeAll() {
    if (this._sock.clearSubscriptions) {
      this._sock.clearSubscriptions();
    }
  }

  destroySockets(ports = []) {
    if (!ports.length) {
      this._sock.closeSockets();
      return;
    }

    for (const port of ports) {
      for (const sock of this._sock.socks) {
        if (sock.remotePort === port) {
          sock.destroy();
          break;
        }
      }
    }
  }

  connect(options, callback) {
    const os = process.platform;
    if (os !== 'win32' && options.unixSocketId) {
      this._useUnixSocket = true;
      this._unixSocketId = options.unixSocketId;
    }
    this._host = options.host;
    this._port = parseInt(options.port);
    this._timeout = parseInt(options.timeout);

    this._sock.once('connect', () => {
      this._closed = false;
      if (callback) {
        callback();
      }
    });
    this._sock.set('retry timeout', 1000);
    this._sock.set('socket timeout', options.timeout || 0);
    return this._sock.connect(this.bindingUri);
  }

  start(options, callback) {
    const os = process.platform;
    if (os !== 'win32' && options.unixSocketId) {
      this._useUnixSocket = true;
      this._unixSocketId = options.unixSocketId;
    }

    this._host = options.host;
    this._port = parseInt(options.port);
    this._timeout = parseInt(options.timeout);

    const cb = (err) => {
      if (err) {
        callback(err);
        return;
      }
      this._closed = false;
      callback();
    };

    /* Create domain in order to catch port binding errors. */
    const domain = require('domain').create();

    domain.on('error', (err) => {
      this._log.warn(
        'bus binding on %s, error: %s',
        this.bindingUri,
        err.stack || err.message || err
      );

      if (/^(EADDRINUSE|EACCES)$/.test(err.code)) {
        this._port++;
        this._log.warn(`address in use, retrying on port ${this._port}`);

        setTimeout(() => {
          this._bind(cb);
        }, 0);
      }
    });

    /* Try binding in domain. */
    domain.run(() => {
      this._bind(cb);
    });
  }

  stop() {
    this.unsubscribeAll();
    for (const event of this._events) {
      if (event.name === 'close') {
        this._sock.emit('close');
      }
      this._sock.removeListener(event.name, event.handler);
    }
    this._events = [];

    if (this._closed) {
      return;
    }

    this._sock.close();
    this._closed = true;

    if (this._host.length) {
      this._log.verb(`bus ${this._host}:${this._port} closed`);
    }
  }
}

module.exports = Axon;
