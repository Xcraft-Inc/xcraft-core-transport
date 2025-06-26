'use strict';

const moduleName = 'streamer';

const fs = require('fs');
const {Writable} = require('stream');
const EventEmitter = require('events');

class Streamer extends EventEmitter {
  #unsubs = [];
  #timeout;

  constructor(streamId, stream, isUpload) {
    super();

    this._send = this._send.bind(this);

    const routingKey = require('xcraft-core-host').getRoutingKey();
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._routingKey = routingKey;
    this._resp = busClient.newResponse(moduleName, 'token');
    this._streamId = streamId;
    this._isUpload = isUpload || false;

    if (stream) {
      this.#sendStream(stream);
    } else {
      this.#receiveStream();
    }
  }

  #sendStream(stream) {
    const streamId = this._streamId;

    /* Send a stream */
    this._stream = stream;
    this.on('send', this._send);

    /* Start of stream */
    const s = (msg) => {
      this.#unsubscribe();
      this.emit('send', msg.data.routingKey);
    };

    this.#unsubs.push(
      this._resp.events.subscribe(`*::stream.started.${streamId}.orcished`, s),
      this._resp.events.subscribe(`*::stream.started.<${streamId}>`, s)
    );
  }

  #receiveStream() {
    const streamId = this._streamId;

    /* Receive a stream */
    const r = (msg) => {
      const chunk =
        msg.data.chunk instanceof Buffer // FIXME: amp weird transform of this buffer?!
          ? msg.data.chunk
          : Buffer.from(msg.data.chunk.data);

      /* See (1) */
      if (msg.data.prefix) {
        chunk[0] = Buffer.from(msg.data.prefix)[0];
      }

      this.emit('receive', chunk, msg.data.current, msg.data.total);
    };

    /* End of stream */
    const e = () => {
      this.#unsubscribe();
      this.emit('ended');
    };

    this.#unsubs.push(
      this._resp.events.subscribe(`*::stream.chunked.${streamId}.orcished`, r),
      this._resp.events.subscribe(`*::stream.chunked.<${streamId}>`, r),
      this._resp.events.subscribe(`*::stream.ended.${streamId}.orcished`, e),
      this._resp.events.subscribe(`*::stream.ended.<${streamId}>`, e)
    );
  }

  #unsubscribe() {
    for (const unsub of this.#unsubs) {
      unsub();
    }
    this.#unsubs.length = 0;
  }

  #clearTimeout() {
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
    }
  }

  #refreshTimeout(next) {
    const timeout = 120000;

    const timeoutCallback = () => {
      this.#unsubscribe();
      next(
        new Error(`Timeout of ${timeout / 1000}s reached for ${this._streamId}`)
      );
    };

    this.#clearTimeout();
    this.#timeout = setTimeout(timeoutCallback, timeout);
  }

  _send(remoteRoutingKey) {
    const id = this._streamId.split('$')[1];
    let total = 0;
    let current = 0;

    if (this._stream instanceof fs.ReadStream) {
      const st = fs.statSync(this._stream.path);
      total = st.size;
    }

    const sender = new Writable({
      autoDestroy: true,
      write: (chunk, _, done) => {
        current += chunk.length;

        /* (1) Prevent bug with the AMP message unpacker which considers that
         * buffers starting with s:, b: or j: are string, BigInt or JSON.
         * Here, we ensure that our buffers stays as buffer when unpacked on
         * the other side.
         * See https://github.com/tj/node-amp-message/issues/5
         */
        let prefix;
        if (
          chunk.length >= 2 &&
          chunk[1] === 58 && // :
          /* s || b || j */
          (chunk[0] === 115 || chunk[0] === 98 || chunk[0] === 106)
        ) {
          prefix = chunk.slice(0, 1).toString();
          chunk[0] = 0;
        }

        const data = {
          streamId: this._streamId,
          chunk,
          current,
          total,
          prefix,
        };
        if (this._isUpload || remoteRoutingKey === this._routingKey) {
          this._resp.command.send(
            `transport.${remoteRoutingKey}.emit-chunk`,
            {...data, ...{_xcraftRPC: true}},
            done
          );
          this._resp.events.send(`transport.<${id}>.chunked`, {
            current,
            total,
          });
        } else {
          this._resp.events.send(
            `stream.chunked.${this._streamId}.orcished`,
            data
          );
          done();
        }
      },
    });

    this._stream
      .pipe(sender)
      .on('finish', () => {
        if (this._isUpload || remoteRoutingKey === this._routingKey) {
          this._resp.command.send(`transport.${remoteRoutingKey}.emit-end`, {
            _xcraftRPC: true,
            streamId: this._streamId,
          });
        } else {
          this._resp.events.send(`stream.ended.${this._streamId}.orcished`);
        }
      })
      .on('error', (err) =>
        this._resp.log.err(err.stack || err.message || err)
      );
  }

  receive(remoteRoutingKey, stream, progress, next) {
    this.#refreshTimeout(next);
    stream.on('error', next);

    this.once('ended', (...args) => {
      this.#clearTimeout();
      stream.once('finish', () => next(...args));
      stream.end();
    });
    this.on('receive', (chunk, current, total) => {
      this.#refreshTimeout(next);
      stream.write(chunk);
      if (progress) {
        progress(current, total);
      }
    });

    const data = {
      routingKey: this._routingKey,
    };

    if (this._routingKey === remoteRoutingKey) {
      this._resp.events.send(`stream.started.${this._streamId}.orcished`, data);
    } else {
      data._xcraftRPC = true;
      data.streamId = this._streamId;
      this._resp.command.send(`transport.${remoteRoutingKey}.start-emit`, data);
    }
  }
}

module.exports = Streamer;
