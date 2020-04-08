'use strict';

const moduleName = 'bus/axon';

const axon = require('xcraft-axon');
const helpers = require('../helpers.js');

class Axon {
  constructor(mode, log) {
    this._closed = true;
    this._host = '';
    this._port = 0;
    this._log = log;
    this._events = [];

    const h = (err) => {
      const xLog = require('xcraft-core-log')(moduleName, null);
      xLog.err(err);
    };

    this._events.push({name: 'error', handler: h});
    this._sock = axon.socket(mode).on('error', h);
  }

  get port() {
    return this._port;
  }

  _bind(callback) {
    this._sock.bind(this._port, this._host, (err) => {
      if (!err) {
        this._log.verb('bus started on %s:%d', this._host, this._port);
      }
      callback(err);
    });
  }

  fixId(oId, nId) {}

  status() {
    return {
      host: this._host,
      port: this._port,
      active: !this._closed,
      subscriptions: this._sock.subscriptions || {},
    };
  }

  on(topic, handler, streamChannel) {
    const h = (...args) => {
      let data = args;
      if (topic === 'message') {
        if (this._sock.socks.length === 0) {
          return;
        }
        data = helpers.fromXcraftJSON(args, (streamId) =>
          streamChannel({streamId})
        );
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

  connect(options, callback) {
    this._sock.once('connect', () => {
      this._closed = false;
      if (callback) {
        callback();
      }
    });
    return this._sock.connect(options.port, options.host);
  }

  start(options, callback) {
    this._host = options.host;
    this._port = parseInt(options.port);

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
        'bus binding on %s:%d, error: %s',
        this._host,
        this._port,
        err.stack || err.message
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
