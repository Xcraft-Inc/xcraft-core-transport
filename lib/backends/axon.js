'use strict';

const moduleName = 'bus/axon';

const path = require('node:path');
const fs = require('fs');
const fse = require('fs-extra');
const is_ip_private = require('private-ip');
const axon = require('xcraft-axon');
const helpers = require('../helpers.js');

const Inode = Symbol.for('Axon.Inode');

function bufferFromData(dataUrl) {
  return dataUrl.startsWith('base64:')
    ? Buffer.from(dataUrl.split(':', 2)[1], 'base64')
    : fs.readFileSync(dataUrl);
}

class Axon {
  constructor(mode, log, acceptIncoming = true, options = null) {
    const xEtc = require('xcraft-core-etc')();
    this._transportConfig = xEtc?.load('xcraft-core-transport') || {};
    this._role = mode === 'push' || mode === 'pull' ? 'cmd' : 'evt';
    this._closed = true;
    this._host = '';
    this._port = 0;
    this._useTLS = false;
    this._useUnixSocket = false;
    this._unixSocketPath = '/tmp';
    this._log = log;
    this._events = [];
    this._acceptIncoming = acceptIncoming;
    this._connectStack = [];
    this._tlsOptions = {};
    this._watcher = null;
    this._staticCerts = [];
    this._options = options ? options : {};

    if (xEtc) {
      const {resourcesPath} = require('xcraft-core-host');
      const staticCertsPath = path.join(resourcesPath, 'certs');
      if (fse.existsSync(staticCertsPath)) {
        this._staticCerts = fse
          .readdirSync(staticCertsPath)
          .filter((file) => file.endsWith('.pem'))
          .map((certPem) =>
            fse.readFileSync(path.join(staticCertsPath, certPem))
          );
      }
    }

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

  get isLocalOnly() {
    return this.isUnixSocket || is_ip_private(this._host);
  }

  get isUnixSocket() {
    return this._useUnixSocket;
  }

  get bindingUri() {
    if (this._useUnixSocket) {
      return `unix://${this._unixSocketPath}/${this.socketId}-${this._role}.sock`;
    } else if (this._useTLS) {
      return `tls://${this._host}:${this._port}`;
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

  get inode() {
    if (!this._sock.socks.length) {
      return undefined;
    }

    if (this._sock.socks.length > 1) {
      throw new Error('bad use of inode getter with a server');
    }

    const sock = this._sock.socks[0];
    return this._getInode(sock, true);
  }

  /**
   * Retrieve the inode for a unix socket.
   *
   * This function is only supported by Linux where the `ss` command is mandatory.
   *
   * @param {net.Socket} sock - The unix socket.
   * @param {boolean} resolve - Retrieve the inode as seen by the server side
   * @returns {*} the inode integer value or undefined.
   */
  _getInode(sock, resolve = false) {
    if (sock[Inode]) {
      return sock[Inode];
    }

    if (!sock._handle) {
      return undefined;
    }

    const {fd} = sock._handle;
    if (!fd) {
      return undefined;
    }

    const path = require('path');
    const {execSync} = require('child_process');

    const inodeFile = path.join(`/proc/${process.pid}/fd/${fd}`);
    try {
      const inode = fs
        .readlinkSync(inodeFile)
        .toString()
        .replace(/[^[]+\[([0-9]+)\]/, '$1');
      /* Retrieve the socket inode for the server side */
      const _inode = resolve
        ? execSync(`ss -H -A unix_stream src :${inode}`)
            .toString()
            .trim()
            .split(/[ ]+/)
        : [inode];
      sock[Inode] = parseInt(_inode[_inode.length - 1]);
      return sock[Inode];
    } catch (ex) {
      /* Ignore errors /!\
       * UNIX socket switching disabled, must be implemented
       * with named pipes on Windows
       */
      return undefined;
    }
  }

  _bind(callback) {
    if (this._options.clientOnly) {
      this._log.warn('listening with AXON is disabled by config');
      callback();
      return;
    }

    this._sock.set('retry timeout', 500);
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

  on(topic, handler, streamChannel, proxy = false) {
    if (topic === 'error') {
      topic = 'socket error'; /* Ensure to catch all possible errors */
    }

    const h = (...args) => {
      let data = args;
      if (topic === 'message') {
        if (this._sock.socks.length === 0) {
          return;
        }

        if (proxy) {
          data = helpers.restoreChunkBuffer(args);
        } else {
          data = helpers.fromXcraftJSON(args, (streamId) =>
            streamChannel({streamId})
          );
        }

        if (args[0].startsWith('xcraft::axon/')) {
          const event = args[0].split('/')[1];
          switch (event) {
            case 'reject': {
              this._sock.emit('socket error', args[1]);
              break;
            }
          }
          return;
        }

        if (!this._acceptIncoming && args[0] === 'autoconnect') {
          if (proxy) {
            throw new Error('autoconnect via a proxy is forbidden');
          }
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

    const data = helpers.toXcraftJSON(args, (streamId, stream, isUpload) =>
      streamChannel({streamId, stream, isUpload})
    );

    if (this._sock.socks.length === 0 && this._sock.enqueue) {
      this._sock.enqueue([topic, ...data]);
      return;
    }

    if (port) {
      /* Search the right socket or send to all sockets */
      for (const sock of this._sock.socks) {
        if (
          sock.remotePort === port || // TCP
          this._getInode(sock) === port // UNIX
        ) {
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
        if (
          sock.remotePort === port || // TCP
          this._getInode(sock) === port // UNIX
        ) {
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
      this._sock.set('disable zlib', true);
    }
    /* When a server self-signed certificate is passed,
     * then we connect by using TLS.
     */
    if (options.caPath) {
      this._useTLS = true;
      const tlsOpts = {
        ca: bufferFromData(options.caPath),
        checkServerIdentity: () => null,
      };
      /* When using a client certificate */
      if (options.keyPath && options.certPath) {
        tlsOpts.key = bufferFromData(options.keyPath);
        tlsOpts.cert = bufferFromData(options.certPath);
      }
      this._sock.set('tls', tlsOpts);
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
    this._sock.set('retry timeout', 500);
    this._sock.set('socket timeout', options.timeout || 0);
    this._sock.set('tcp connect keep-alive', options.clientKeepAlive);
    return this._sock.connect(this.bindingUri);
  }

  start(options, callback) {
    const os = process.platform;
    if (os !== 'win32' && options.unixSocketId) {
      this._useUnixSocket = true;
      this._unixSocketId = options.unixSocketId;
      this._sock.set('disable zlib', true);
    }
    /* When a key and a cert are passed,
     * then we listen by using TLS.
     */
    if (options.keyPath && options.certPath) {
      const {certsPath, keysPath, requestClientCert} = this._transportConfig;
      const fse = require('fs-extra');

      this._useTLS = true;
      this._tlsOptions = {
        ca: this._staticCerts,
        key: fs.readFileSync(options.keyPath),
        cert: fs.readFileSync(options.certPath),
        requestCert: !!requestClientCert,
        /* Don't reject because we handle with Axon because Electron BoringSSL is bugged */
        rejectUnauthorized: false, // !!requestClientCert,
      };
      this._sock.set('tls', this._tlsOptions);

      const chokidar = require('chokidar');
      fse.ensureDirSync(certsPath);
      fse.ensureDirSync(keysPath);

      this._watcher = chokidar
        .watch(this._transportConfig.certsPath)
        .on('add', async () => await this.refreshCerts())
        .on('change', async () => await this.refreshCerts())
        .on('unlink', async () => await this.refreshCerts());
    }

    this._sock.set('tcp onconnect keep-alive', options.serverKeepAlive);

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
          domain.run(() => {
            this._bind(cb);
          });
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

    if (this._watcher) {
      this._watcher.close().then();
    }

    this._events = [];
    this._sock.close();

    if (this._closed) {
      return;
    }

    this._closed = true;

    if (this._host.length) {
      this._log.verb(`bus ${this._host}:${this._port} closed`);
    }
  }

  refreshCerts() {
    const {certsPath} = this._transportConfig;

    const dynamicCerts = fse
      .readdirSync(certsPath)
      .filter((file) => file.endsWith('.pem'))
      .map((certPem) => fse.readFileSync(path.join(certsPath, certPem)));

    this._tlsOptions.ca = [];
    this._tlsOptions.ca.push(...this._staticCerts, ...dynamicCerts);

    this._sock.server.setSecureContext(this._tlsOptions);
  }
}

module.exports = Axon;
