'use strict';

const moduleName = 'bus/axon';

const axon = require ('axon');

class Axon {
  constructor (mode, log) {
    this._closed = true;
    this._host = '';
    this._port = 0;
    this._log = log;
    this._sock = axon.socket (mode).on ('socket error', err => {
      const xLog = require ('xcraft-core-log') (moduleName, null);
      xLog.err (err);
    });
  }

  _bind (callback) {
    this._sock.bind (this._port, this._host, err => {
      if (!err) {
        this._log.verb ('bus started on %s:%d', this._host, this._port);
      }
      callback (err);
    });
  }

  on (topic, handler) {
    this._sock.on (topic, handler);
    return this;
  }

  send (...args) {
    if (this._closed) {
      return;
    }
    return this._sock.send (...args);
  }

  subscribe (...args) {
    return this._sock.subscribe (...args);
  }

  unsubscribe (...args) {
    return this._sock.unsubscribe (...args);
  }

  connect (port, host) {
    return this._sock.connect (port, host, () => {
      this._closed = false;
    });
  }

  start (options, callback) {
    this._host = options.host;
    this._port = parseInt (options.port);

    const cb = err => {
      if (err) {
        callback (err);
        return;
      }
      this._closed = false;
      callback ();
    };

    /* Create domain in order to catch port binding errors. */
    const domain = require ('domain').create ();

    domain.on ('error', err => {
      this._log.warn (
        'bus binding on %s:%d, error: %s',
        this._host,
        this._port,
        err.message
      );

      if (/^(EADDRINUSE|EACCES)$/.test (err.code)) {
        this._port++;
        this._log.warn (`address in use, retrying on port ${this._port}`);

        setTimeout (() => {
          this._bind (cb);
        }, 0);
        return;
      }

      this._log.err ('this exception is fatal, we cannot continue...');
      process.exit (1);
    });

    /* Try binding in domain. */
    domain.run (() => {
      this._bind (cb);
    });
  }

  stop () {
    if (this._closed) {
      return;
    }

    this._sock.close ();
    this._closed = true;
    if (this._host.length) {
      this._log.verb (`bus ${this._host}:${this._port} closed`);
    }
  }
}

module.exports = Axon;
