'use strict';

const moduleName = 'bus/axon';

const axon = require('xcraft-axon');
const {isImmutable} = require('immutable');
const Shredder = require('xcraft-core-shredder');
const transit = require('transit-immutable-js');

class Axon {
  constructor(mode, log) {
    this._closed = true;
    this._host = '';
    this._port = 0;
    this._log = log;
    this._sock = axon.socket(mode).on('socket error', err => {
      const xLog = require('xcraft-core-log')(moduleName, null);
      xLog.err(err);
    });
  }

  get port() {
    return this._port;
  }

  _bind(callback) {
    this._sock.bind(this._port, this._host, err => {
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

  on(topic, handler) {
    const wrap = (type, data) =>
      type === 'Shredder' ? new Shredder(data) : data;

    this._sock.on(topic, (...args) => {
      const data = args.map(d => {
        let n = null;

        /* Restore immutable payload */
        ['Immutable', 'Shredder'].forEach(type => {
          if (d[`_xcraft${type}`]) {
            if (!n) {
              n = Object.assign({}, d);
            }

            for (const key in d[`_xcraft${type}`]) {
              if (key === '.') {
                n.data = wrap(type, transit.fromJSON(d[`_xcraft${type}`][key]));
              } else {
                n.data[key] = wrap(
                  type,
                  transit.fromJSON(d[`_xcraft${type}`][key])
                );
              }
            }

            delete n[`_xcraft${type}`];
          }
        });

        return n || d;
      });

      return handler(...data);
    });

    return this;
  }

  static immutableToJSON(data) {
    if (!data) {
      return {data, type: 'Object'};
    }

    if (isImmutable(data)) {
      const n = transit.toJSON(data);
      return {data: n, type: 'Immutable'};
    }

    if (data._isSuperReaper6000) {
      const n = transit.toJSON(data.state);
      return {data: n, type: 'Shredder'};
    }

    return {data, type: 'Object'};
  }

  send(topic, ...args) {
    if (this._closed) {
      return;
    }

    const data = args.map(d => {
      if (!d._xcraftMessage || !d.data) {
        return d;
      }

      /* Handle immutable d.data payload */
      const imm = Axon.immutableToJSON(d.data);
      if (imm.type !== 'Object') {
        const n = Object.assign({}, d);

        if (!n[`_xcraft${imm.type}`]) {
          n[`_xcraft${imm.type}`] = {};
        }
        n[`_xcraft${imm.type}`]['.'] = imm.data;
        n.data = null;

        return n;
      }

      /* Handle immutable d.data[keys] payloads */
      if (typeof d.data === 'object') {
        let n = null;

        for (const key in d.data) {
          const imm = Axon.immutableToJSON(d.data[key]);
          if (imm.type !== 'Object') {
            if (!n) {
              n = Object.assign({}, d);
            }

            if (!n[`_xcraft${imm.type}`]) {
              n[`_xcraft${imm.type}`] = {};
            }
            n[`_xcraft${imm.type}`][`.${key}`] = imm.data;
            n.data[key] = null;
          }
        }

        return n || d;
      }

      return d;
    });

    return this._sock.send(topic, ...data);
  }

  subscribe(re, ids) {
    return this._sock.subscribe(re, ids);
  }

  unsubscribe(re) {
    return this._sock.unsubscribe(re);
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

    const cb = err => {
      if (err) {
        callback(err);
        return;
      }
      this._closed = false;
      callback();
    };

    /* Create domain in order to catch port binding errors. */
    const domain = require('domain').create();

    domain.on('error', err => {
      this._log.warn(
        'bus binding on %s:%d, error: %s',
        this._host,
        this._port,
        err.message
      );

      if (/^(EADDRINUSE|EACCES)$/.test(err.code)) {
        this._port++;
        this._log.warn(`address in use, retrying on port ${this._port}`);

        setTimeout(() => {
          this._bind(cb);
        }, 0);
        return;
      }

      this._log.err('this exception is fatal, we cannot continue...');
      process.exit(1);
    });

    /* Try binding in domain. */
    domain.run(() => {
      this._bind(cb);
    });
  }

  stop() {
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
