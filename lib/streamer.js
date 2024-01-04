'use strict';

const moduleName = 'streamer';

const fs = require('fs');
const {Writable} = require('stream');
const EventEmitter = require('events');

class Streamer extends EventEmitter {
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
    const unsubs = [];

    /* Send a stream */
    this._stream = stream;
    this.on('send', this._send);

    /* Start of stream */
    const s = (msg) => {
      for (const unsub of unsubs) {
        unsub();
      }
      this.emit('send', msg.data.routingKey);
    };

    unsubs.push(
      this._resp.events.subscribe(`*::stream.started.${streamId}.orcished`, s),
      this._resp.events.subscribe(`*::stream.started.<${streamId}>`, s)
    );
  }

  #receiveStream() {
    const streamId = this._streamId;
    const unsubs = [];

    /* Receive a stream */
    const r = (msg) => {
      this.emit(
        'receive',
        msg.data.chunk instanceof Buffer // FIXME: amp weird transform of this buffer?!
          ? msg.data.chunk
          : Buffer.from(msg.data.chunk.data),
        msg.data.current,
        msg.data.total
      );
    };

    /* End of stream */
    const e = () => {
      for (const unsub of unsubs) {
        unsub();
      }
      this.emit('ended');
    };

    unsubs.push(
      this._resp.events.subscribe(`*::stream.chunked.${streamId}.orcished`, r),
      this._resp.events.subscribe(`*::stream.chunked.<${streamId}>`, r),
      this._resp.events.subscribe(`*::stream.ended.${streamId}.orcished`, e),
      this._resp.events.subscribe(`*::stream.ended.<${streamId}>`, e)
    );
  }

  _send(remoteRoutingKey) {
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
        const data = {
          streamId: this._streamId,
          chunk,
          current,
          total,
        };
        if (this._isUpload || remoteRoutingKey === this._routingKey) {
          this._resp.command.send(
            `transport.${remoteRoutingKey}.emit-chunk`,
            {...data, ...{_xcraftRPC: true}},
            done
          );
        } else {
          this._resp.events.send(
            `stream.chunked.${this._streamId}.orcished`,
            data
          );
          done();
        }
      },
    });

    this._stream.pipe(sender).on('finish', () => {
      if (this._isUpload || remoteRoutingKey === this._routingKey) {
        this._resp.command.send(`transport.${remoteRoutingKey}.emit-end`, {
          streamId: this._streamId,
          _xcraftRPC: true,
        });
      } else {
        this._resp.events.send(`stream.ended.${this._streamId}.orcished`);
      }
    });
  }

  receive(remoteRoutingKey, stream, progress, next) {
    this.once('ended', next);
    this.on('receive', (chunk, current, total) => {
      stream.write(chunk);
      if (progress) {
        progress(current, total);
      }
    });

    if (this._routingKey === remoteRoutingKey) {
      this._resp.events.send(`stream.started.${this._streamId}.orcished`, {
        routingKey: remoteRoutingKey,
      });
    } else {
      this._resp.command.send(`transport.${remoteRoutingKey}.start-emit`, {
        streamId: this._streamId,
        routingKey: this._routingKey,
        _xcraftRPC: true,
      });
    }
  }
}

module.exports = Streamer;
